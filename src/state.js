/**
 * dsh-link state persistence — durable JSON snapshot of peerHealth, sessionStore,
 * sessionByPeer across HMR reloads and DSH host restarts.
 *
 * [why]: v0.4.0 HMR-based self-upgrade needs state to survive `fiber.dispose()`.
 *        Vendor HMR (`vendor/hmr/src/index.ts:504-509`) disposes old plugin fiber
 *        and re-applies new code; we flush our Maps here before that dispose.
 *        Storage path is the profile-local `dsh-link-state.json`; we do NOT use
 *        fork `sessionPersistence` (that's session-event log, not plugin state).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Resolve the canonical state file path under the active DSH profile. */
export function resolveStatePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'web'
  return join(home, 'profiles', profile, 'dsh-link-state.json')
}

/**
 * Persist the three Maps atomically: write to `<path>.tmp`, rename to `<path>`.
 * On rename failure the original is preserved; failure is logged via the supplied
 * logger and swallowed — losing one snapshot never breaks the upgrade path.
 */
export function saveState(statePath, peerHealth, sessionStore, sessionByPeer, logger) {
  try {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      peerHealth: [...peerHealth.entries()],
      sessionStore: [...sessionStore.entries()],
      sessionByPeer: [...sessionByPeer.entries()].map(([k, set]) => [k, [...set]]),
    }
    mkdirSync(dirname(statePath), { recursive: true })
    const tmp = statePath + '.tmp'
    writeFileSync(tmp, JSON.stringify(payload))
    renameSync(tmp, statePath)
  } catch (e) {
    if (logger) logger.warn(`[dsh-link] state save failed: ${e.message}`)
  }
}

/**
 * Load the previous snapshot into the supplied Maps. A missing or corrupted
 * file is logged but never thrown — fresh installs start empty.
 */
export function loadState(statePath, peerHealth, sessionStore, sessionByPeer, logger) {
  if (!existsSync(statePath)) return 0
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    let n = 0
    if (Array.isArray(raw.peerHealth)) {
      for (const [k, v] of raw.peerHealth) peerHealth.set(k, v)
    }
    if (Array.isArray(raw.sessionStore)) {
      for (const [k, v] of raw.sessionStore) {
        sessionStore.set(k, v)
        n++
      }
    }
    if (Array.isArray(raw.sessionByPeer)) {
      for (const [k, arr] of raw.sessionByPeer) sessionByPeer.set(k, new Set(arr))
    }
    if (logger) logger(`[dsh-link] hydrated ${n} sessions from state (savedAt=${raw.savedAt ?? 'unknown'})`)
    return n
  } catch (e) {
    if (logger) logger.warn(`[dsh-link] state load failed: ${e.message}; starting empty`)
    return 0
  }
}
