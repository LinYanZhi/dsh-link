/**
 * dsh-link — bidirectional cross-machine remote-control for DeepSeek Harness.
 *
 * Each host:
 *   - listens on a token-authenticated HTTP port (default 8124)
 *   - exposes a `remote` tool so its own agent can POST a task to a peer
 *   - exposes a `remote_peers` tool to list configured peers and recent health
 *   - on receiving a task, executes it locally via DSH headless, replies with outcome
 *
 * Usage from the local agent:
 *   remote({ peer: "company", task: "configure the model to use minimax-cn" })
 *   remote({ peer: "company", task: "你刚才的结果是 X，能详细说说吗？" })  // follow-up
 *   remote_peers({})  // list peers
 *
 * Stateless model: each `remote` call spawns a fresh headless session on the peer.
 * Interactive dialogs are achieved by the calling agent issuing multiple `remote`
 * calls in sequence and feeding the previous result back as context.
 *
 * For NATed setups (two LAN-only machines), pair with UU Remote port mapping
 * or any TCP tunnel that maps peer:<port> -> 127.0.0.1:<some-port>.
 *
 * [why]: v0.2.0 extends the 2026-09 archived plugin with (1) default port 8124
 *        (avoids clashing with UU Remote's tunnel-side port 8123), (2) tolerant
 *        URL parsing (auto-prepend http:// when missing), (3) `remote_peers`
 *        tool for AI to discover valid peer names, (4) per-peer health tracking
 *        so failures surface in the tool result, (5) graceful port-conflict
 *        degradation: outbound `remote` still works even when the local
 *        listener can't bind.
 */

import { createServer as httpCreateServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-link'
export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  /** Named peer endpoints this host can send tasks to. */
  peers: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
        token: z.string().default(''),
      }),
    )
    .default([]),
  /**
   * Local listen port. 0 disables listening (outbound `remote` still works).
   * Default 8124 to avoid clashing with UU Remote's tunnel-side port 8123.
   */
  port: z.number().default(8124),
  /** Token required on inbound requests; empty = accept from LAN only. */
  token: z.string().default(''),
  /** Command to launch the local DSH headless that executes inbound tasks. */
  headlessCmd: z.array(z.string()).default([]),
  /** Timeout for a remote execution, in ms. */
  timeoutMs: z.number().default(300_000),
  /** Optional extra text appended to the system prompt section. */
  systemPromptExtra: z.string().default(''),
})

const REMOTE_PROMPT_BASE =
  'dsh-link is available: you can command a peer DeepSeek Harness over a TCP tunnel (e.g. UU Remote) by calling the `remote` tool. ' +
  'When the user asks to command another device (e.g. configure the company PC from home, or vice versa), call `remote` with the peer name and a self-contained natural-language task. ' +
  "The peer's own agent executes the task via DSH headless and returns the outcome.\n\n" +
  'Tips:\n' +
  '- The peer name is one of the configured `peers[]`; call `remote_peers` to list them.\n' +
  '- The task is natural-language; the peer agent decides how to interpret and execute.\n' +
  '- `remote` calls are stateless one-shots: each call spawns a fresh headless session on the peer.\n' +
  '- For interactive dialogs, issue multiple `remote` calls in sequence (ask, read the answer, then ask a follow-up referencing the previous result).\n' +
  '- Pass task content directly; do not reference local paths the peer cannot see.\n' +
  '- If `remote` returns `{ok: false, error: ...}`, the failure is logged in `remote_peers` — check there before retrying.\n\n' +
  'When you phrase the task, treat it as a complete instruction to an autonomous agent (the peer has no shared context with you).'

/** Resolve the local `dsh` headless invocation used to run an inbound task. */
function resolveHeadlessCmd(cmd) {
  if (cmd.length > 0) return [...cmd]
  const home = homedir()
  const candidates = [
    join(home, 'bin', 'dsh.cmd'),
    join(home, 'bin', 'dsh'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return [c, '--profile', 'headless']
  }
  // Phone container path
  const phoneEntry = '/root/.dsh-arm64/node_modules/@deepseek-ai/dsh/lib/bin.js'
  if (existsSync(phoneEntry)) return ['node', '--expose-internals', phoneEntry, 'headless']
  // PC fork source launch (preferred — always works with the local clone)
  const forkBin = join(
    home,
    'Code', '.github', 'LinYanZhi-Fork', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js',
  )
  if (existsSync(forkBin)) return ['node', '--import', 'tsx/esm', forkBin, '--profile', 'headless']
  return ['dsh', '--profile', 'headless']
}

/** POST a task to a peer, return the JSON response body. */
function postTask(url, token, task, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(url)
    } catch {
      // tolerate missing scheme
      try {
        u = new URL('http://' + url)
      } catch (e2) {
        reject(new Error(`invalid peer url ${url}: ${e2.message}`))
        return
      }
    }
    const payload = JSON.stringify({ task })
    const req = httpRequest(
      u,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body))
            } catch {
              resolve({ ok: true, output: body })
            }
          } else {
            reject(new Error(`peer ${u.host} responded ${res.statusCode}: ${body.slice(0, 500)}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`peer ${u.host} timed out after ${timeoutMs}ms`))
    })
    req.end(payload)
  })
}

/** Run a local DSH headless task, streaming its stdout back. */
function runLocalHeadless(cmd, task, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], [...cmd.slice(1), task], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cmd[0]) ? true : false,
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`local headless timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ ok: true, output: out })
      } else {
        resolve({ ok: false, output: out, error: err.slice(0, 1000), exitCode: code })
      }
    })
  })
}

// Per-peer health tracking (kept in plugin state, lost on dispose)
const peerHealth = new Map()  // peerName -> { lastOk, lastError, lastTask }

export function apply(ctx, config) {
  // systemPrompt: teach the agent when/how to use remote
  const promptText = REMOTE_PROMPT_BASE + (config.systemPromptExtra ? '\n\n' + config.systemPromptExtra : '')
  // [why]: fork's SECTION_ORDERS doesn't reserve a 'DSH_LINK' key, so
  //        getSectionOrder() returns undefined and section() throws
  //        `order must be a finite number`. Use a stable explicit order instead —
  //        2950 sits right after TOOL_REPORT (2900) and matches the
  //        "tool description" semantic. Hardcoding avoids a fork upgrade blowing
  //        this plugin up again if the table layout changes.
  ctx.systemPrompt.section({
    name: 'tool:dsh-link',
    order: 2950,
    text: promptText,
  })

  // Local inbound listener: execute tasks sent by a peer.
  let server = null
  let actualPort = config.port
  if (config.port > 0) {
    const headlessCmd = resolveHeadlessCmd(config.headlessCmd)
    server = httpCreateServer((req, res) => {
      const send = (code, obj) => {
        const body = JSON.stringify(obj)
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(body)
      }
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      if (config.token) {
        const auth = req.headers.authorization || ''
        if (auth !== `Bearer ${config.token}`) return send(401, { ok: false, error: 'unauthorized' })
      }
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        let task
        try {
          task = JSON.parse(raw).task
        } catch {
          return send(400, { ok: false, error: 'bad json' })
        }
        if (typeof task !== 'string' || task.length === 0) {
          return send(400, { ok: false, error: 'task required' })
        }
        try {
          const result = await runLocalHeadless(headlessCmd, task, config.timeoutMs)
          send(200, result)
        } catch (e) {
          send(500, { ok: false, error: e.message })
        }
      })
    })
    server.on('error', (err) => {
      // Busy port must not take down the agent: degrade to client-only mode and log loudly.
      ctx.logger.warn(`[dsh-link] cannot listen on port ${config.port}: ${err.message}; continuing without inbound listener (outbound \`remote\` tool still works)`)
      server = null
      actualPort = 0
    })
    server.listen(config.port, '0.0.0.0', () => {
      ctx.logger(`[dsh-link] listening on 0.0.0.0:${actualPort}`)
    })
    ctx.on('dispose', () => {
      try {
        server?.close()
      } catch {
        /* already closed */
      }
    })
  }

  // Tool: send a task to a named peer.
  ctx.tools.register(defineTool({
    name: 'remote',
    description:
      'Send a task to a peer DeepSeek Harness (e.g. the company PC or the home PC). ' +
      'The peer runs the task through its own DSH agent and returns the result. ' +
      "Use when the user asks to command another device's agent, such as configuring " +
      "the company's models from home or vice versa. " +
      'Calls are stateless one-shots; issue multiple calls in sequence for interactive dialogs.',
    parameters: {
      peer: { type: 'string', required: true, description: 'peer name, from dsh-link config peers[]' },
      task: { type: 'string', required: true, description: 'natural-language task for the peer agent' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const peer = config.peers.find((p) => p.name === args.peer)
      if (!peer) {
        return { ok: false, error: `unknown peer: ${args.peer}. Use \`remote_peers\` to list configured peers.` }
      }
      try {
        const result = await postTask(peer.url, peer.token, args.task, config.timeoutMs)
        peerHealth.set(args.peer, { lastOk: Date.now(), lastError: null, lastTask: args.task })
        return result
      } catch (e) {
        peerHealth.set(args.peer, { lastOk: null, lastError: e.message, lastTask: args.task })
        return { ok: false, error: e.message }
      }
    },
  }))

  // Tool: list configured peers + recent health (so the AI can discover valid peer names and debug failures).
  ctx.tools.register(defineTool({
    name: 'remote_peers',
    description:
      'List configured dsh-link peers and their recent health (last successful call, last error, last task preview). ' +
      'Use to discover valid peer names before calling `remote`, and to diagnose why a `remote` call failed.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const list = config.peers.map((p) => {
        const h = peerHealth.get(p.name) || { lastOk: null, lastError: null, lastTask: null }
        return {
          name: p.name,
          url: p.url,
          lastOk: h.lastOk ? new Date(h.lastOk).toISOString() : null,
          lastError: h.lastError,
          lastTask: h.lastTask
            ? h.lastTask.slice(0, 80) + (h.lastTask.length > 80 ? '…' : '')
            : null,
        }
      })
      return {
        ok: true,
        thisHost: { listeningPort: actualPort, token: config.token ? 'set' : 'empty' },
        peers: list,
      }
    },
  }))
}
