/**
 * dsh-link — bidirectional cross-machine remote-control for DeepSeek Harness.
 *
 * Each host listens on a token-authenticated HTTP port (default 8124) and exposes
 * `remote` + `remote_peers` tools so its own agent can delegate tasks to peers
 * (typically bridged via UU Remote port mapping for NATed setups).
 *
 * Session model (v0.3.0): sessions are CLIENT-SIDE state in the calling agent's
 * plugin instance. Each remote task is still a stateless one-shot on the peer
 * (server unchanged); the session just lets the caller transparently thread a
 * summary of the previous reply into the next prompt.
 *
 * [why]: v0.3.0 adds (1) client-side `sessionStore` with TTL cleanup, (2) `session`
 *        parameter on `remote` that prepends the prior reply summary, (3)
 *        `sessionId` echoed back for follow-ups, (4) sessions in `remote_peers`.
 *        Server-side is unchanged so upgrades on either side don't break the other.
 */

import { createServer as httpCreateServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-link'
export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  peers: z
    .array(z.object({ name: z.string(), url: z.string(), token: z.string().default('') }))
    .default([]),
  port: z.number().default(8124),  // avoids UU Remote's tunnel-side port 8123
  token: z.string().default(''),
  headlessCmd: z.array(z.string()).default([]),
  timeoutMs: z.number().default(300_000),
  sessionTtlMs: z.number().default(30 * 60 * 1000),  // sessions are client-side; affects only follow-up ability
  systemPromptExtra: z.string().default(''),
})

const REMOTE_PROMPT_BASE =
  'dsh-link is available: you can command a peer DeepSeek Harness over a TCP tunnel (e.g. UU Remote) by calling the `remote` tool. ' +
  'When the user asks to command another device, call `remote` with the peer name and a self-contained natural-language task. ' +
  "The peer's own agent executes the task via DSH headless and returns the outcome.\n\n" +
  'Tips:\n' +
  '- The peer name is one of the configured `peers[]`; call `remote_peers` to list them.\n' +
  '- The task is natural-language; the peer agent decides how to interpret and execute.\n' +
  '- Pass task content directly; do not reference local paths the peer cannot see.\n' +
  '- If `remote` returns `{ok: false, error: ...}`, the failure is logged in `remote_peers`.\n\n' +
  '**Sessions (v0.3.0+)** — chain follow-up questions on the same topic:\n' +
  '- FIRST call for a topic: omit `session`. The result includes a `sessionId`.\n' +
  '- FOLLOW-UPS about the same topic: pass `session: "<that sessionId>"`. The plugin prepends the previous reply summary before posting.\n' +
  '- Sessions default to a 30-minute TTL on the calling agent side; expired/unknown ids fail with "session ... not found or expired".\n' +
  '- For a fresh unrelated topic, omit `session` again (you get a new sessionId).\n' +
  "- Call `remote_peers` to list current sessions if you've lost track.\n\n" +
  'Phrase the task as a complete instruction to an autonomous agent (the peer has no shared context with you beyond what the session summary provides).'

function resolveHeadlessCmd(cmd) {
  if (cmd.length > 0) return [...cmd]
  const home = homedir()
  for (const c of [join(home, 'bin', 'dsh.cmd'), join(home, 'bin', 'dsh')]) {
    if (existsSync(c)) return [c, '--profile', 'headless']
  }
  const phoneEntry = '/root/.dsh-arm64/node_modules/@deepseek-ai/dsh/lib/bin.js'
  if (existsSync(phoneEntry)) return ['node', '--expose-internals', phoneEntry, 'headless']
  // PC fork source launch (preferred — always works with the local clone)
  const forkBin = join(home, 'Code', '.github', 'LinYanZhi-Fork', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
  if (existsSync(forkBin)) return ['node', '--import', 'tsx/esm', forkBin, '--profile', 'headless']
  return ['dsh', '--profile', 'headless']
}

function postTask(url, token, task, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) }
    catch {
      try { u = new URL('http://' + url) }
      catch (e2) { reject(new Error(`invalid peer url ${url}: ${e2.message}`)); return }
    }
    const payload = JSON.stringify({ task })
    const req = httpRequest(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)) } catch { resolve({ ok: true, output: body }) }
        } else {
          reject(new Error(`peer ${u.host} responded ${res.statusCode}: ${body.slice(0, 500)}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`peer ${u.host} timed out after ${timeoutMs}ms`)))
    req.end(payload)
  })
}

function runLocalHeadless(cmd, task, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], [...cmd.slice(1), task], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cmd[0]) ? true : false,
    })
    let out = '', err = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`local headless timed out after ${timeoutMs}ms`)) }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true, output: out } : { ok: false, output: out, error: err.slice(0, 1000), exitCode: code })
    })
  })
}

// ----------------------------------------------------------------------------
// Session store (v0.3.0+, client-side state)
// Each session is "a topic in progress" between this agent and a peer. Server
// is unchanged — we just prepend the prior reply summary before posting. Pure
// caller-side bookkeeping; lost on plugin dispose / agent restart.
// ----------------------------------------------------------------------------

const MAX_SUMMARY_CHARS = 500
const REAP_INTERVAL_MS = 60_000

function summarizeOutput(out) {
  if (typeof out !== 'string') return ''
  return out.length <= MAX_SUMMARY_CHARS ? out : out.slice(0, MAX_SUMMARY_CHARS) + '\n[…truncated]'
}

function buildContextualTask(task, session) {
  if (!session) return task
  return (
    '[Continuing cross-machine session]\n' +
    `Peer: ${session.peerName}\n` +
    `Prior exchanges in this session: ${session.messageCount}\n\n` +
    'Previous agent reply (summary):\n' + session.summary +
    '\n\n[User now asks:]\n' + task
  )
}

const peerHealth = new Map()    // peerName -> { lastOk, lastError, lastTask }
const sessionStore = new Map()  // sessionId -> { id, peerName, createdAt, lastUsedAt, summary, messageCount }
const sessionByPeer = new Map() // peerName -> Set<sessionId>

function reapExpiredSessions(ttlMs) {
  const now = Date.now()
  for (const [id, s] of sessionStore) {
    if (now - s.lastUsedAt <= ttlMs) continue
    sessionStore.delete(id)
    const set = sessionByPeer.get(s.peerName)
    if (set) { set.delete(id); if (set.size === 0) sessionByPeer.delete(s.peerName) }
  }
}

export function apply(ctx, config) {
  const promptText = REMOTE_PROMPT_BASE + (config.systemPromptExtra ? '\n\n' + config.systemPromptExtra : '')
  // [why]: fork's SECTION_ORDERS doesn't reserve a 'DSH_LINK' key, so
  //        getSectionOrder() returns undefined and section() throws
  //        `order must be a finite number`. Hardcode 2950 to sit right
  //        after TOOL_REPORT (2900) and survive fork upgrades.
  ctx.systemPrompt.section({ name: 'tool:dsh-link', order: 2950, text: promptText })

  // Session reap loop. .unref() so the timer doesn't keep the event loop alive.
  let reapTimer = setInterval(() => reapExpiredSessions(config.sessionTtlMs), REAP_INTERVAL_MS)
  if (typeof reapTimer.unref === 'function') reapTimer.unref()
  ctx.on('dispose', () => { if (reapTimer) { clearInterval(reapTimer); reapTimer = null } })

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
        try { task = JSON.parse(raw).task }
        catch { return send(400, { ok: false, error: 'bad json' }) }
        if (typeof task !== 'string' || task.length === 0) return send(400, { ok: false, error: 'task required' })
        try {
          const result = await runLocalHeadless(headlessCmd, task, config.timeoutMs)
          send(200, result)
        } catch (e) { send(500, { ok: false, error: e.message }) }
      })
    })
    server.on('error', (err) => {
      // Busy port must not take down the agent; degrade to client-only mode.
      ctx.logger.warn(`[dsh-link] cannot listen on port ${config.port}: ${err.message}; continuing without inbound listener`)
      server = null
      actualPort = 0
    })
    server.listen(config.port, '0.0.0.0', () => ctx.logger(`[dsh-link] listening on 0.0.0.0:${actualPort}`))
    ctx.on('dispose', () => { try { server?.close() } catch {} })
  }

  ctx.tools.register(defineTool({
    name: 'remote',
    description:
      'Send a task to a peer DeepSeek Harness (e.g. the company PC or the home PC). ' +
      "The peer runs the task through its own DSH agent and returns the result. " +
      'For follow-up questions about the same topic, pass `session: "<id>"` from a previous result; the prior reply summary is prepended automatically.',
    parameters: {
      peer: { type: 'string', required: true, description: 'peer name, from dsh-link config peers[]' },
      task: { type: 'string', required: true, description: 'natural-language task for the peer agent' },
      session: { type: 'string', required: false, description: 'optional sessionId from a prior `remote` call on the same topic' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args) {
      const peer = config.peers.find((p) => p.name === args.peer)
      if (!peer) return { ok: false, error: `unknown peer: ${args.peer}. Use \`remote_peers\` to list configured peers.` }

      let session = null
      if (args.session) {
        session = sessionStore.get(args.session)
        if (!session) return { ok: false, error: `session ${args.session} not found or expired. Omit \`session\` to start a fresh task; call \`remote_peers\` to list active sessions.` }
      }

      const contextualTask = buildContextualTask(args.task, session)
      try {
        const result = await postTask(peer.url, peer.token, contextualTask, config.timeoutMs)
        peerHealth.set(args.peer, { lastOk: Date.now(), lastError: null, lastTask: args.task })

        // Record / advance the session on a successful reply. Summarize so a
        // runaway peer reply can't blow up the next prompt.
        const now = Date.now()
        const sessionId = args.session || randomUUID()
        sessionStore.set(sessionId, {
          id: sessionId,
          peerName: peer.name,
          createdAt: session?.createdAt || now,
          lastUsedAt: now,
          summary: summarizeOutput(result.output),
          messageCount: (session?.messageCount || 0) + 1,
        })
        let set = sessionByPeer.get(peer.name)
        if (!set) { set = new Set(); sessionByPeer.set(peer.name, set) }
        set.add(sessionId)

        return {
          ok: result.ok === undefined ? true : result.ok,
          output: result.output,
          error: result.error,
          exitCode: result.exitCode,
          sessionId,
          sessionMessageCount: (session?.messageCount || 0) + 1,
        }
      } catch (e) {
        peerHealth.set(args.peer, { lastOk: null, lastError: e.message, lastTask: args.task })
        // Don't advance on transport failure; prior summary is still relevant.
        return { ok: false, error: e.message }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'remote_peers',
    description:
      'List configured dsh-link peers, their recent health, and currently active sessions. ' +
      'Use to discover valid peer names before calling `remote`, to find a sessionId you lost track of, and to diagnose failures.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute() {
      const now = Date.now()
      return {
        ok: true,
        thisHost: { listeningPort: actualPort, token: config.token ? 'set' : 'empty' },
        peers: config.peers.map((p) => {
          const h = peerHealth.get(p.name) || { lastOk: null, lastError: null, lastTask: null }
          return {
            name: p.name, url: p.url,
            lastOk: h.lastOk ? new Date(h.lastOk).toISOString() : null,
            lastError: h.lastError,
            lastTask: h.lastTask ? h.lastTask.slice(0, 80) + (h.lastTask.length > 80 ? '…' : '') : null,
          }
        }),
        sessions: [...sessionStore.values()].map((s) => ({
          sessionId: s.id,
          peer: s.peerName,
          messageCount: s.messageCount,
          ageMs: now - s.createdAt,
          lastUsedAgoMs: now - s.lastUsedAt,
          summaryPreview: s.summary.slice(0, 80) + (s.summary.length > 80 ? '…' : ''),
        })),
      }
    },
  }))
}
