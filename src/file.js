/**
 * dsh-link v0.4.0 file transfer endpoints and tools.
 *
 * [why]: User asked for basic file transfer so a peer can hand artifacts back
 *        without re-running tasks just to fetch bytes. Endpoints are gated by
 *        a sandbox root (default `<dshHome>/profiles/<profile>/dsh-link-files/`)
 *        to keep paths from escaping to system dirs. Size-capped to 10 MB so
 *        an accidental 4 GB upload cannot lock the loop.
 *
 * Endpoints:
 *   POST /file {op:"write", path, content (base64), checksum?} → {ok, size, mtime}
 *   POST /file {op:"read",  path}                              → {ok, content, size, mtime}
 *
 * Constraints:
 *   - token-gated (Bearer)
 *   - sandboxed to resolveFileRoot() (path traversal rejected)
 *   - size cap 10 MB per file
 *   - checksum optional on write; verified on read
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { MAX_FILE_BYTES } from './upgrade.js'

export function resolveFileRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'web'
  return join(home, 'profiles', profile, 'dsh-link-files')
}

/** Reject paths that resolve outside the sandbox root. */
function safeJoin(root, requested) {
  if (typeof requested !== 'string' || requested.length === 0) return null
  if (requested.includes('\0')) return null
  // Normalize separators and strip leading separators so we never escape via "..".
  const cleaned = requested.replace(/[\\/]+/g, '/').replace(/^(\.\.\/)+/, '').replace(/^\/+/, '')
  const full = resolve(root, cleaned)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (full !== root && !full.startsWith(rootWithSep)) return null
  return full
}

export async function handleFile(req, raw, config, respond, logger) {
  if (req.url !== '/file') return false
  if (req.method !== 'POST') return respond(405, { ok: false, error: 'method not allowed' })
  if (config.token) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${config.token}`) return respond(401, { ok: false, error: 'unauthorized' })
  }

  let body
  try { body = JSON.parse(raw || '{}') }
  catch { return respond(400, { ok: false, error: 'bad json' }) }

  const { op, path: relPath, content, checksum } = body
  if (op !== 'write' && op !== 'read') return respond(400, { ok: false, error: 'op must be "write" or "read"' })
  const fullPath = safeJoin(resolveFileRoot(), relPath)
  if (fullPath === null) return respond(400, { ok: false, error: 'path rejected (sandbox)' })

  if (op === 'write') {
    if (typeof content !== 'string') return respond(400, { ok: false, error: 'content (base64) required' })
    let bytes
    try { bytes = Buffer.from(content, 'base64') }
    catch (e) { return respond(400, { ok: false, error: `base64 decode failed: ${e.message}` }) }
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
      return respond(400, { ok: false, error: `size ${bytes.length} out of range (1..${MAX_FILE_BYTES})` })
    }
    if (typeof checksum === 'string' && checksum.length > 0) {
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== checksum.toLowerCase()) {
        return respond(400, { ok: false, error: `checksum mismatch: got ${actual}, expected ${checksum}` })
      }
    }
    try {
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, bytes)
    } catch (e) {
      return respond(500, { ok: false, error: `write failed: ${e.message}` })
    }
    const st = statSync(fullPath)
    if (logger) logger(`[dsh-link] file write: ${relPath} (${bytes.length} bytes)`)
    return respond(200, { ok: true, op: 'write', path: relPath, size: bytes.length, mtime: st.mtimeMs })
  }

  // read
  if (!existsSync(fullPath)) return respond(404, { ok: false, error: 'not found' })
  let st
  try { st = statSync(fullPath) } catch (e) { return respond(500, { ok: false, error: e.message }) }
  if (st.size > MAX_FILE_BYTES) return respond(413, { ok: false, error: `file too large: ${st.size} > ${MAX_FILE_BYTES}` })
  let bytes
  try { bytes = readFileSync(fullPath) }
  catch (e) { return respond(500, { ok: false, error: `read failed: ${e.message}` }) }
  const actualChecksum = createHash('sha256').update(bytes).digest('hex')
  if (logger) logger(`[dsh-link] file read: ${relPath} (${bytes.length} bytes)`)
  return respond(200, {
    ok: true, op: 'read', path: relPath,
    content: bytes.toString('base64'),
    size: bytes.length, mtime: st.mtimeMs, checksum: actualChecksum,
  })
}
