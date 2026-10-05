/**
 * dsh-link systemPrompt — v0.4.0 subagent-flavoured.
 *
 * [why]: User asked for the cross-machine remote to feel like an embedded
 *        subagent inside the current conversation, not a one-shot tool call.
 *        Fork has `packages/subagent/` with `dsh-subagent-dsh-sdk`; we mirror
 *        its surface ("run a subagent on a peer") over HTTP + Bearer so the
 *        model invokes it like a fork-native subagent.
 */

export const REMOTE_PROMPT_BASE =
  'dsh-link gives you embedded subagents on peer DeepSeek Harness hosts. ' +
  'A peer runs as a child agent in the same conversation — its replies, follow-ups, ' +
  'and tool activity flow back through the session you opened.\n\n' +
  'Tools:\n' +
  '- `remote_subagent_list` — discover peer names, their health, and active subagent sessions.\n' +
  '- `remote_subagent_run` — open a new subagent session on a peer; returns a sessionId.\n' +
  '- `remote_subagent_followup` — continue an existing session; the peer remembers everything.\n' +
  '- `remote_subagent_cancel` — end a session explicitly.\n\n' +
  'Sessions:\n' +
  '- Each `remote_subagent_run` returns a `sessionId`; pass it to `remote_subagent_followup` for any follow-up.\n' +
  '- Sessions auto-expire after 30 minutes of inactivity on the calling side; peer stays stateless.\n' +
  '- For an unrelated topic, call `remote_subagent_run` again (no sessionId) — you get a fresh session.\n\n' +
  'Phrase the task as a complete instruction to an autonomous agent — the peer has no context beyond ' +
  'what your session has threaded so far. Paths and identifiers must be readable on the peer machine.'

export const SUBAGENT_TOOL_DESCRIPTIONS = {
  remote_subagent_list:
    'List configured peers, their recent health, and currently active subagent sessions. ' +
    'Use to discover valid peer names before `remote_subagent_run`, to find a sessionId you lost track of, ' +
    'and to diagnose failures.',
  remote_subagent_run:
    'Open a new subagent session on a peer DeepSeek Harness. The peer runs as a child agent: its reply ' +
    'and any tool activity stream back as the result. Returns a sessionId for follow-ups.',
  remote_subagent_followup:
    'Continue an existing subagent session. The previous reply summary is prepended automatically so the ' +
    'peer keeps continuity. Pass the sessionId from a prior `remote_subagent_run` or `remote_subagent_followup`.',
  remote_subagent_cancel:
    'End a subagent session explicitly. Idempotent; unknown sessionIds report not-found.',
}

export const FILE_TOOL_DESCRIPTIONS = {
  send_file:
    'Write a file to a peer under its dsh-link sandbox (default `~/.dsh/profiles/<profile>/dsh-link-files/`). ' +
    'Size cap 10 MB; checksum verified.',
  read_file:
    'Read a file from a peer under its dsh-link sandbox. Returns content + size + mtime.',
}

export const UPGRADE_TOOL_DESCRIPTIONS = {
  upgrade_peer:
    'Ship a new version of dsh-link to a peer and trigger HMR-based hot reload. The peer stays up — its ' +
    'plugin fiber is disposed and the new source is reloaded in place. Pass base64-encoded `payload`, a ' +
    'sha256 `checksum` of the decoded bytes, the target `version` label, and an optional `dryRun` to verify ' +
    'checksum without writing.',
}
