# Changelog

## v0.4.0 (2026-10-05)

### Added
- **HMR-based self-upgrade**: `/upgrade` endpoint accepts base64 + sha256 of new src/index.js; atomic write + backup; fork `vendor/hmr/` (already auto-loaded by DSH, see `apps/cli/src/profile-boot.ts:281`) detects the file change, disposes the plugin fiber, re-imports and re-applies — all without restarting DSH. Active `state.json` survives because dispose flushes before reload and apply hydrates after.
- **`/handshake` endpoint**: returns `{version, capabilities, wire}` so peers can negotiate features before assuming compatibility.
- **`upgrade_peer` tool**: ship a new version of dsh-link to a peer and trigger its HMR reload from the local model.
- **`send_file` / `read_file` tools** and **`/file` endpoint**: cross-machine file transfer under a sandbox root (default `<dshHome>/profiles/<profile>/dsh-link-files/`), 10 MB cap, optional sha256 verification.
- **State persistence (`src/state.js`)**: peerHealth / sessionStore / sessionByPeer serialized to `~/.dsh/profiles/<profile>/dsh-link-state.json` on dispose, hydrated on apply. Survives HMR reloads and DSH restarts.
- **Subagent-style tool rename**: `remote` / `remote_peers` → `remote_subagent_run` / `remote_subagent_followup` / `remote_subagent_cancel` / `remote_subagent_list`. New `remote_subagent_followup` makes peer follow-ups a first-class call. systemPrompt rewritten so the model treats peers as embedded subagents (mirrors fork `packages/subagent/`'s surface).
- **cordis.patch.yml HMR snippet** (`docs/snippet-cordis-patch.yml`): the 8-line block home and company machines append to enable HMR watching `dsh-link/src`.
- **Company-machine setup guide** (`docs/COMPANY-MACHINE-SETUP.md`): plain-language install steps for the human "intermediary" who relays setup commands to the company AI.

### Changed
- Wire protocol remains a strict superset of v0.3.0: the original `POST /` task endpoint is unchanged, so v0.3.0 peers still work against v0.4.0 endpoints.
- All registered `remote_*` tool names changed — v0.3.0 callers will see only the new names.

### Known limitations
- v0.4.0 retains the v0.3.0 11.5-second cold start per `remote_subagent_run` (still spawns a fresh headless each call); persistent cross-restart sessions via subagent-API work in `packages/subagent/` upstream are not bridged here.
- HMR requires cordis.patch.yml to enable the `hmr` row; without that block DSH keeps HMR loaded but with empty roots and `/upgrade` writes never trigger reload.

## v0.3.0 (2026-10-03)

### Added
- **Sessions (client-side state)**: `sessionStore: Map<sessionId, Entry>` keeps per-topic context (peer, createdAt, lastUsedAt, summary, messageCount) on the calling agent's plugin instance.
- **`session` parameter on `remote` tool**: when set, the plugin prepends the previous reply summary to the new task before posting, so the peer's headless DSH receives both pieces of context in a single user message.
- **`sessionId` echoed back** in the `remote` tool result so the AI can pass it on follow-ups.
- **`sessions: [...]` field in `remote_peers`** so the AI can list / re-discover active sessionIds.
- **`sessionTtlMs` Config field** (default 30 minutes). Expired sessions reaped every 60s.
- **system prompt section** now explains the session flow to the AI.

### Unchanged
- Wire protocol (HTTP POST + Bearer + JSON `{task}`) is identical to v0.2.0. Server-side has zero changes; upgrading either side independently is safe.
- `remote_peers` schema is a strict superset (added `sessions`).
- All v0.2.0 features (port 8124, URL tolerance, peer health tracking, graceful port-conflict degradation) preserved.

### Design notes
- Sessions are **purely caller-side bookkeeping** — the peer server is stateless, unchanged. This means either side can restart without breaking ongoing sessions on the other (only the caller loses its session state).
- Summary truncation at 500 chars (`MAX_SUMMARY_CHARS`) prevents a runaway peer reply from blowing up the next prompt.
- `reapTimer.unref()` so the timer doesn't keep the event loop alive after the plugin is disposed.
- Sessions are NOT advanced on transport failure (the prior summary is still relevant for retry).
- Unknown / expired sessionIds fail loud (`"session ... not found or expired"`) rather than silently dropping context.

## v0.2.0 (2026-10-02)

### Added
- Initial plugin (lifted from `_archive/dsh-link-已卸载-2026-09-21/` archive).
- Default port 8124 (avoids clashing with UU Remote's tunnel-side port 8123).
- Tolerant URL parsing (auto-prepend `http://` when missing).
- `remote_peers` tool for AI to discover valid peer names + recent health.
- Per-peer health tracking (`lastOk`, `lastError`, `lastTask`).
- Graceful port-conflict degradation (outbound `remote` still works even when local listener can't bind).
- Verified end-to-end on home machine (11.5s task round-trip via UU Remote port mapping).
- Pushed to GitHub: https://github.com/LinYanZhi/dsh-link (commit `be3cb44`).
