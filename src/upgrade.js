/**
 * dsh-link v0.4.0 self-upgrade endpoints and tool.
 *
 * [why]: User asked for cross-machine DSH-link updates that don't interrupt
 *        running sessions. Approach: ship the new source over HTTP, atomically
 *        write to the install path, and let fork `vendor/hmr/` (already loaded
 *        by `apps/cli/src/profile-boot.ts:281-285`) detect the file change and
 *        dispose+reapply the plugin fiber in place. State hydrates back from
 *        `state.json` on the new fiber; in-flight HTTP responses finish before
 *        the dispose.
 *
 * Endpoints:
 *   POST /handshake   → { version, capabilities, wire }
 *   POST /upgrade     → { ok, applied, version, backup } on success
 *
 * Constraints:
 *   - token-gated (Bearer header)
 *   - checksum-gated (sha256 of decoded payload)
 *   - size-cap 1 MB source
 *   - atomic write: tmp → rename
 *   - backup current src → src/index.js.bak-<version>-<ts>
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)
const { request: httpRequest } = require('node:http')

export const DSH_LINK_VERSION = '0.5.0'
export const DSH_LINK_CAPABILITIES = [
  'remote_subagent_run',
  'remote_subagent_followup',
  'remote_subagent_cancel',
  'remote_subagent_list',
  'send_file',
  'read_file',
  'upgrade_peer',
  'state_persistence',
  'tui_command',
]
export const MAX_UPGRADE_BYTES = 1 * 1024 * 1024
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Resolve the on-disk path of `src/index.js` for this plugin install. */
export function resolveSourcePath() {
  // dsh-link is installed as `file:..\..\..\Code\dsh-link` → node_modules/dsh-link resolves there.
  // `import.meta.url` of state.js is <Code/dsh-link/src/state.js>; two levels up is <Code/dsh-link>.
  const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  // `here` ends with /src/; go up one level to dsh-link root, then into src/index.js.
  return join(here, '..', 'src', 'index.js').replace(/\\/g, '/')
}

/**
 * HTTP handler body for /handshake and /upgrade. `config.token` gates; `respond`
 * is `(code, obj)` from the caller. Returns the boolean "did handle".
 */
export async function handleUpgrade(req, raw, config, respond, logger) {
  if (req.url !== '/upgrade' && req.url !== '/handshake') return false
  if (req.method !== 'POST') return respond(405, { ok: false, error: 'method not allowed' })
  if (config.token) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${config.token}`) return respond(401, { ok: false, error: 'unauthorized' })
  }

  if (req.url === '/handshake') {
    return respond(200, {
      ok: true,
      version: DSH_LINK_VERSION,
      capabilities: DSH_LINK_CAPABILITIES,
      wire: 'v1',
    })
  }

  // /upgrade body: { payload: base64, checksum: sha256 hex, version: string, dryRun?: bool }
  let body
  try { body = JSON.parse(raw || '{}') }
  catch { return respond(400, { ok: false, error: 'bad json' }) }

  const { payload, checksum, version, dryRun } = body
  if (typeof payload !== 'string' || typeof checksum !== 'string' || typeof version !== 'string') {
    return respond(400, { ok: false, error: 'payload, checksum, version required' })
  }

  let bytes
  try { bytes = Buffer.from(payload, 'base64') }
  catch (e) { return respond(400, { ok: false, error: `base64 decode failed: ${e.message}` }) }
  if (bytes.length === 0 || bytes.length > MAX_UPGRADE_BYTES) {
    return respond(400, { ok: false, error: `payload size ${bytes.length} out of range (1..${MAX_UPGRADE_BYTES})` })
  }

  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== checksum.toLowerCase()) {
    return respond(400, { ok: false, error: `checksum mismatch: got ${actual}, expected ${checksum}` })
  }

  if (dryRun) return respond(200, { ok: true, dryRun: true, version, size: bytes.length })

  const srcPath = resolveSourcePath()
  if (!existsSync(srcPath)) return respond(500, { ok: false, error: `source not found at ${srcPath}` })

  const backup = srcPath + '.bak-' + version.replace(/[^a-z0-9._-]/gi, '_') + '-' + Date.now()
  try {
    mkdirSync(dirname(backup), { recursive: true })
    writeFileSync(backup, readFileSync(srcPath))
  } catch (e) {
    return respond(500, { ok: false, error: `backup failed: ${e.message}` })
  }

  try {
    const tmp = srcPath + '.tmp'
    writeFileSync(tmp, bytes)
    renameSync(tmp, srcPath)
  } catch (e) {
    return respond(500, { ok: false, error: `atomic write failed: ${e.message}; backup at ${backup}` })
  }

  if (logger) logger(`[dsh-link] upgrade applied: ${version} (${bytes.length} bytes); backup at ${backup}; HMR will reload`)
  return respond(200, { ok: true, applied: true, version, size: bytes.length, backup })
}

/**
 * Outbound client side: POST /upgrade to a peer. Used by the `upgrade_peer` tool.
 */
export function postUpgrade(peerUrl, peerToken, payload, checksum, version, dryRun, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL('/upgrade', peerUrl)
    const body = JSON.stringify({ payload, checksum, version, dryRun })
    const req = httpRequest(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(peerToken ? { Authorization: `Bearer ${peerToken}` } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf)) } catch { resolve({ ok: true, raw: buf }) }
        } else {
          reject(new Error(`peer ${u.host} /upgrade ${res.statusCode}: ${buf.slice(0, 500)}`))
        }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
