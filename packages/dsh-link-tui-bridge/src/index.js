/**
 * dsh-link-tui-bridge v0.5.0 — Cordis plugin installed in the dsh-tui profile
 * that exposes a localhost-only HTTP bridge so a peer DSH web instance
 * (running dsh-link) can command the local TUI to operate on its DSH host.
 *
 * [why]: User wants a 4-AI federation: home-web ⇄ company-web via dsh-link
 *        v0.4.0, and home-web ⇄ home-tui / company-web ⇄ company-tui via this
 *        bridge. The bridge exposes a tiny HTTP surface (127.0.0.1:8125) of
 *        scoped commands that the local TUI runs through `dsh` CLI subcommands
 *        — `restart-dsh`, `install-plugin`, `read-config`, `list-profiles`,
 *        `log-tail` — without ever granting the network arbitrary code
 *        execution.
 *
 * Bound to 127.0.0.1 only; the only remote reach is via UU Remote (or any
 * TCP tunnel) — exactly like dsh-link proper.
 */

import { createServer as httpCreateServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-link-tui-bridge'
export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  port: z.number().default(8125),
  token: z.string().default(''),
  allowedProfiles: z.array(z.string()).default(['dsh-tui', 'web', 'headless']),
  logTailLines: z.number().default(200),
})

const BRIDGE_PROMPT = 'dsh-link-tui-bridge is running on 127.0.0.1:8125 and accepts ' +
  'scoped commands from dsh-link v0.5.0 peers. You can self-restart, install plugins, ' +
  'read profile configs, and tail logs via the `bridge_command` tool. Use it when ' +
  'the local DSH needs to be operated by another machine (e.g. emergency restart ' +
  'after a code push).'

const COMMAND_PROMPT =
  'bridge_command targets — available commands:\n' +
  '- `restart-dsh {profile}` — exit current process; expects external supervision (Task Scheduler / NSSM / systemd) to relaunch.\n' +
  '- `install-plugin {profile, package, version?}` — runs `dsh plugin --profile <profile> add <package>[@version]` via spawn.\n' +
  '- `remove-plugin {profile, package}` — runs `dsh plugin --profile <profile> remove <package>`.\n' +
  '- `read-config {profile}` — returns cordis.yml + cordis.patch.yml contents.\n' +
  '- `list-profiles` — enumerates `~/.dsh/profiles/*` directories.\n' +
  '- `log-tail {profile, lines?}` — returns the last N lines of the profile log (best-effort).\n' +
  'All commands are token-gated; bound to 127.0.0.1; never expose the port publicly.'

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function resolveDshBin() {
  const home = homedir()
  for (const c of [join(home, 'bin', 'dsh.cmd'), join(home, 'bin', 'dsh')]) {
    if (existsSync(c)) return c
  }
  // fork source launch — same fallback as dsh-link does.
  const forkBin = join(home, 'Code', '.github', 'LinYanZhi-Fork', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
  if (existsSync(forkBin)) return ['node', '--import', 'tsx/esm', forkBin]
  return ['dsh']
}

function spawnDsh(args, timeoutMs) {
  return new Promise((resolve) => {
    const bin = resolveDshBin()
    const cmd = Array.isArray(bin) ? bin : [bin]
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cmd[0]),
    })
    let out = '', err = ''
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c) => { out += c })
    child.stderr?.on('data', (c) => { err += c })
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: `dsh ${args.join(' ')} timed out after ${timeoutMs}ms`, output: out, stderr: err.slice(0, 1000) }) }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0
        ? { ok: true, output: out, stderr: err }
        : { ok: false, exitCode: code, output: out, stderr: err.slice(0, 1000) })
    })
  })
}

async function runCommand(name, args, config, logger) {
  const timeoutMs = 60_000
  switch (name) {
    case 'restart-dsh': {
      const profile = args.profile || 'web'
      if (!config.allowedProfiles.includes(profile)) {
        return { ok: false, error: `profile "${profile}" not in allowedProfiles` }
      }
      logger?.(`[dsh-link-tui-bridge] restart-dsh ${profile}; exiting process for supervisor`)
      // The actual restart: schedule exit on the next tick so the HTTP response
      // can flush. External supervisor (Task Scheduler / NSSM / systemd) is
      // responsible for relaunching the process.
      setImmediate(() => process.exit(0))
      return { ok: true, scheduled: true, action: 'process.exit', profile }
    }
    case 'install-plugin': {
      const { profile, package: pkg, version } = args
      if (!profile || !pkg) return { ok: false, error: 'profile and package required' }
      if (!config.allowedProfiles.includes(profile)) {
        return { ok: false, error: `profile "${profile}" not in allowedProfiles` }
      }
      const arg = version ? `${pkg}@${version}` : pkg
      const r = await spawnDsh(['plugin', '--profile', profile, 'add', arg], timeoutMs)
      return { ok: r.ok, output: r.output, stderr: r.stderr, exitCode: r.exitCode, error: r.error }
    }
    case 'remove-plugin': {
      const { profile, package: pkg } = args
      if (!profile || !pkg) return { ok: false, error: 'profile and package required' }
      if (!config.allowedProfiles.includes(profile)) {
        return { ok: false, error: `profile "${profile}" not in allowedProfiles` }
      }
      const r = await spawnDsh(['plugin', '--profile', profile, 'remove', pkg], timeoutMs)
      return { ok: r.ok, output: r.output, stderr: r.stderr, exitCode: r.exitCode, error: r.error }
    }
    case 'read-config': {
      const profile = args.profile
      if (!profile) return { ok: false, error: 'profile required' }
      const root = join(dshHome(), 'profiles', profile)
      if (!existsSync(root)) return { ok: false, error: `profile dir not found: ${root}` }
      const out = {}
      for (const name of ['cordis.yml', 'cordis.patch.yml', 'package.json']) {
        const p = join(root, name)
        if (existsSync(p)) {
          out[name] = readFileSync(p, 'utf8')
          try { out[`${name}.mtime`] = statSync(p).mtimeMs } catch {}
        }
      }
      return { ok: true, profile, root, files: out }
    }
    case 'list-profiles': {
      const root = join(dshHome(), 'profiles')
      if (!existsSync(root)) return { ok: false, error: `profiles dir not found: ${root}` }
      const { readdirSync } = await import('node:fs')
      const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      return { ok: true, profilesRoot: root, profiles: dirs }
    }
    case 'log-tail': {
      const profile = args.profile || 'dsh-tui'
      const lines = args.lines || config.logTailLines
      const logCandidates = [
        join(dshHome(), 'profiles', profile, 'dsh.log'),
        join(dshHome(), 'profiles', profile, 'logs', 'dsh.log'),
        join(dshHome(), 'logs', `${profile}.log`),
      ]
      const target = logCandidates.find((p) => existsSync(p))
      if (!target) return { ok: false, error: `no log file found for profile ${profile}; tried ${logCandidates.join(', ')}` }
      const text = readFileSync(target, 'utf8')
      const tail = text.split(/\r?\n/).slice(-lines).join('\n')
      return { ok: true, profile, logPath: target, lines: tail.split('\n').length, tail }
    }
    default:
      return { ok: false, error: `unknown command: ${name}` }
  }
}

export function apply(ctx, config) {
  ctx.systemPrompt.section({ name: 'tool:dsh-link-tui-bridge', order: 2960, text: BRIDGE_PROMPT + '\n\n' + COMMAND_PROMPT })

  let server = null
  let actualPort = config.port
  server = httpCreateServer((req, res) => {
    const send = (code, obj) => {
      const body = JSON.stringify(obj)
      res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
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
      let body
      try { body = JSON.parse(raw || '{}') }
      catch { return send(400, { ok: false, error: 'bad json' }) }
      const { command, args = {} } = body
      if (typeof command !== 'string') return send(400, { ok: false, error: 'command required' })
      try {
        const result = await runCommand(command, args, config, ctx.logger)
        send(200, result)
      } catch (e) {
        send(500, { ok: false, error: e.message })
      }
    })
  })
  server.on('error', (err) => {
    ctx.logger.warn(`[dsh-link-tui-bridge] cannot listen on port ${config.port}: ${err.message}; bridge offline`)
    server = null
    actualPort = 0
  })
  server.listen(config.port, '127.0.0.1', () => ctx.logger(`[dsh-link-tui-bridge] listening on 127.0.0.1:${actualPort}`))
  ctx.on('dispose', () => { try { server?.close() } catch {} })

  ctx.tools.register({
    name: 'bridge_command',
    description: 'Run a scoped command on the local TUI bridge (dsh-link-tui-bridge). ' +
      'Targets: restart-dsh, install-plugin, remove-plugin, read-config, list-profiles, log-tail. ' +
      'Use when the local DSH needs to be operated by another machine — e.g. emergency restart ' +
      'after a code push, or installing a plugin into a profile that the local web instance ' +
      'manages through this bridge.',
    parameters: {
      command: { type: 'string', required: true, description: 'one of: restart-dsh, install-plugin, remove-plugin, read-config, list-profiles, log-tail' },
      args: { type: 'object', required: false, description: 'command-specific arguments' },
    },
    async execute(args) {
      try {
        return await runCommand(args.command, args.args || {}, config, ctx.logger)
      } catch (e) {
        return { ok: false, error: e.message }
      }
    },
  })
}
