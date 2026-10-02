# Changelog

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
