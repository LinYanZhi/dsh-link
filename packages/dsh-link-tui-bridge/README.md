# dsh-link-tui-bridge v0.5.0

> Companion plugin to **dsh-link**. Installed into a `dsh-tui` (or any) profile.
> Exposes a localhost-only HTTP bridge (default `127.0.0.1:8125`) so a peer DSH web
> instance — running **dsh-link v0.5.0** with its `tui_command` tool — can command
> the local DSH/TUI to operate on its host: restart DSH, install/remove plugins,
> read profile configs, tail logs, list profiles.

## What it does

Let a remote AI (家里 web / 公司 web) ask the local TUI to do things on the local
DSH — without exposing arbitrary shell or filesystem access. Commands are scoped,
token-gated, and bound to `127.0.0.1`. The only network reach into the bridge is
through `dsh-link v0.5.0` over UU Remote (or any TCP tunnel), exactly like
`dsh-link` itself.

## Install (in `dsh-tui` profile)

```powershell
cd $env:USERPROFILE\.dsh\profiles\dsh-tui
pnpm add file:..\..\..\..\..\Code\dsh-link\packages\dsh-link-tui-bridge
```

Then append to `~/.dsh/profiles/dsh-tui/cordis.patch.yml` (don't overwrite):

```yaml
# === dsh-link-tui-bridge v0.5.0 ===
# [why]: 2026-10 enable peer DSH web instances to command this TUI's host
#        (restart, install plugins, read configs) via dsh-link v0.5.0
#        tui_command. Bound to 127.0.0.1; token shared with dsh-link peers[].
- insert:
    - id: dsh-link-tui-bridge
      name: dsh-link-tui-bridge/src
      config:
        port: 8125
        token: mysecret2026    # same token as dsh-link peers[].token on the
                               # web instances that should command this bridge
        allowedProfiles: ['web', 'dsh-tui', 'headless']
        logTailLines: 200
```

Restart the profile (`dsh --profile dsh-tui`); look for
`[dsh-link-tui-bridge] listening on 127.0.0.1:8125` in the log.

## Wire-up with dsh-link v0.5.0

In **dsh-link**'s `~/.dsh/profiles/web/cordis.patch.yml`, add a peer whose URL
points at the **local** bridge:

```yaml
- id: dsh-link
  name: dsh-link/src
  config:
    peers:
      - name: company                     # remote machine
        kind: web                        # default; talks peer.dsh-link directly
        url: http://127.0.0.1:8123
        token: mysecret2026
      - name: home-tui                    # local TUI
        kind: tui                        # routes via bridge_command, not /task
        url: http://127.0.0.1:8125
        token: mysecret2026
      - name: company-tui                 # remote TUI (reached via company-web)
        kind: tui
        url: http://127.0.0.1:8123       # same UU-Remote port as company web
        token: mysecret2026
    port: 8124
    token: mysecret2026
    timeoutMs: 300000
```

The `tui_command` tool then sends `{command, args}` over HTTP to the peer's URL.
A `kind: tui` peer transparently switches the JSON body shape — dsh-link handles
the routing.

## Commands

| command | args | returns |
|---|---|---|
| `restart-dsh` | `{profile?}` | `{ok, scheduled, action: "process.exit"}` — process exits next tick; supervisor (Task Scheduler / NSSM / systemd) must relaunch |
| `install-plugin` | `{profile, package, version?}` | `{ok, output, stderr, exitCode}` from `dsh plugin --profile <profile> add <pkg>` |
| `remove-plugin` | `{profile, package}` | `{ok, output, stderr, exitCode}` from `dsh plugin --profile <profile> remove <pkg>` |
| `read-config` | `{profile}` | `{ok, profile, root, files: {cordis.yml, cordis.patch.yml, package.json}}` |
| `list-profiles` | `{}` | `{ok, profilesRoot, profiles: [...]}` |
| `log-tail` | `{profile?, lines?}` | `{ok, profile, logPath, lines, tail}` — best-effort log tail |

## Limitations

- **`restart-dsh` is a `process.exit(0)`** — the bridge does not start the new
  process itself. The host needs an external supervisor (Task Scheduler on Windows,
  NSSM, systemd on Linux). Without one, the process won't come back.
- **`install-plugin` / `remove-plugin` reuse the `dsh` CLI** — they fail if the
  CLI itself is unreachable from the bridge process.
- **`log-tail` is best-effort** — picks the first existing log path from a small
  candidate list. Custom log locations need extending.
- **Token is shared** across all peers and the local bridge. Rotate by editing
  `cordis.patch.yml` on both sides (see `~/.dsh/.credentials.yaml` for a future
  credentials-store integration).
