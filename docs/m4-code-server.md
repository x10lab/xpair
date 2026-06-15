# m4-code-server — VS Code-based Editor Integration Plan

## Status (as of scaffold delivery)

**What is working now:** `client/cli/remote-pair-editor` launches an unmodified
`code-server` process if it is already installed. A host shell can load
`http://127.0.0.1:${EDITOR_PORT}` to show the editor tab.

**What is future work:** the full custom fork (layout patches, branded shell,
bundled extensions, Electron packaging) is a multi-week effort. This document
is the honest plan, not a promise of a finished product.

---

## (a) Fork

The upstream fork has been created at:

    https://github.com/ghyeongl/code-server

It is a fork of `coder/code-server` (MIT-licensed). No local clone is kept in
this repo — the repository is large (~600 MB at time of writing) and is tracked
as a remote fork only.

---

## (b) Vendoring options — keeping upstream-trackable

We want to be able to pull upstream security fixes while accumulating our own
patches. Three viable strategies, in order of ascending commitment:

### Option 1 — git remote (recommended for now)

Add `ghyeongl/code-server` as a git remote inside a separate local clone. Pull
upstream tags periodically, rebase our patches on top.

```
# one-time
git clone git@github.com:ghyeongl/code-server.git ~/code/code-server-fork
cd ~/code/code-server-fork
git remote add upstream git@github.com:coder/code-server.git

# periodic update
git fetch upstream
git rebase upstream/main
```

Pros: full history, easy rebasing, no repo bloat here.
Cons: maintained separately from this repo.

### Option 2 — git subtree

Pull the fork into `vendor/code-server/` as a subtree. Patches are commits in
this repo; upstream merges are `git subtree pull`.

```
git subtree add --prefix vendor/code-server \
  git@github.com:ghyeongl/code-server.git main --squash
```

Pros: all in one repo, no submodule UX friction.
Cons: repo size balloons; CI checkout time increases significantly.

### Option 3 — git submodule

```
git submodule add git@github.com:ghyeongl/code-server.git vendor/code-server
```

Pros: repo stays small, fork is pinned at a commit.
Cons: submodule UX is notoriously awkward; contributors must remember
`--recurse-submodules`.

**Decision for now:** Option 1. No vendor directory is added to this repo until
the patch surface justifies the cost. Revisit at v0.5.0.

---

## (c) Layout patches — what requires what

The user's target UI: **left terminal / right desktop** split inside a single
browser tab (or Electron window), with a Claude Code extension pane.

| Goal | Achievable via extension / settings? | Requires workbench source patch? |
|---|---|---|
| Custom sidebar panel order | Yes — `workbench.activityBar.location`, `editor.sidebarLocation` | No |
| Terminal always-on-left layout | Partial — panel position settings; full left-docked terminal needs patch | Needs `src/vs/workbench/browser/layout.ts` edit |
| Iframe desktop view pane | No — VS Code's sandbox blocks arbitrary iframes in extensions | Yes — custom webview panel with relaxed CSP in workbench |
| Branded title bar / splash | No (settings only suppress it) | Yes — `product.json` + workbench HTML template |
| Stable extension sidecar process (Claude Code) | Yes — extension host runs normally in code-server | No |
| Single-key approve button in status bar | Yes — extension `StatusBarItem` | No |

**Immediate wins (no source patch needed):**

1. Set `"terminal.integrated.defaultLocation": "editor"` + layout saved workspace.
2. Ship a `.vscode/settings.json` and `.vscode/extensions.json` in the default
   opened workspace so every new folder gets the RemotePair defaults.
3. Use code-server's `--user-data-dir` pointing to `~/.remote-pair/code-server`
   so settings survive restarts without touching the user's main VS Code profile.

**Patches that need workbench source changes:**

These are tracked as issues in `ghyeongl/code-server` and will land in a
dedicated `remotepair/layout` branch on the fork. They touch:

- `src/vs/workbench/browser/layout.ts` — add `remotepaireLeftTerminalLayout` mode
- `src/vs/workbench/contrib/webview/browser/webviewElement.ts` — relax iframe sandbox for the desktop pane
- `product.json` — branding, telemetry opt-out, extension gallery pointing to Open VSX

None of these are in the scaffold; they are future work.

---

## (d) Claude Code extension via Open VSX

code-server uses the Open VSX registry (`open-vsx.org`) instead of the
Microsoft marketplace. The Claude Code VS Code extension is published on Open
VSX as `anthropic.claude-code` (verify current availability before pinning).

**Install at code-server startup** (add to `remote-pair-editor` once confirmed):

```bash
code-server --install-extension anthropic.claude-code
```

Or pre-populate `~/.remote-pair/code-server/extensions/` by running the install
once and committing the extension directory — avoids a network round-trip on
every new host.

**Settings to wire it up** (`~/.remote-pair/code-server/User/settings.json`):

```json
{
  "claude-code.autoStart": true,
  "terminal.integrated.defaultProfile.osx": "bash"
}
```

Status: not yet automated. Manual install works today with an installed
code-server. Automation is future work.

---

## (e) Electron packaging (later)

code-server ships a Node.js HTTP server; it is not an Electron app. For an
Electron shell we have two options:

1. **VS Code fork directly** (like Cursor) — fork `microsoft/vscode`, apply
   patches, build with `npm run gulp vscode-darwin-arm64`. This is a much larger
   undertaking (multi-week, complex build toolchain).

2. **Electron wrapper around code-server** — a thin Electron shell that loads
   `http://127.0.0.1:${EDITOR_PORT}` in a `BrowserWindow` with
   `nodeIntegration: false`. Simpler, ships faster, but lacks deep native
   integration (no native menus, no drag-drop from Finder to editor pane).

**Recommendation:** start with Option 2 (Electron wrapper) as a v0.6 milestone
after the layout patches land. Option 1 is the v1.0 target.

Neither is implemented in this scaffold.

---

## (f) Explicit status summary

| Item | Status |
|---|---|
| Fork created at `ghyeongl/code-server` | Done |
| `client/cli/remote-pair-editor` scaffold | Done — launches stock code-server if installed |
| install.sh wiring (LOCAL_BIN install) | Integration point — see below; not yet wired |
| `remote-pair editor` subcommand | Integration point — not yet wired in `client/cli/remote-pair` |
| EDITOR_PORT config default | Integration point — not yet in `config.sh` / CLIENT_KEYS |
| Claude Code extension auto-install | Future work |
| Layout patches (left-terminal/right-desktop) | Future work |
| Custom workbench source patches | Future work |
| Electron packaging | Future work (v0.6+) |

---

## Integration points for ORCH / wiring pass

1. **`shared/install.sh`** — add a client-side install block for the editor
   launcher:
   ```bash
   if [ -f "$CLIENT_DIR/remote-pair-editor" ]; then
     say "[client] editor launcher → $LOCAL_BIN/remote-pair-editor"
     install_file "$CLIENT_DIR/remote-pair-editor" "$LOCAL_BIN/remote-pair-editor" 755
   fi
   ```

2. **`client/cli/remote-pair`** — add `editor` subcommand that delegates to
   `$LOCAL_BIN/remote-pair-editor "$@"`. Register it in the usage header as:
   ```
   remote-pair editor [start|status|stop] [<folder>]
                              Launch / manage the local code-server editor tab.
   ```

3. **`shared/config.sh`** — add to CLIENT_KEYS and derive default:
   ```bash
   EDITOR_PORT="${EDITOR_PORT:-8080}"
   ```
   Add `EDITOR_PORT` to `CLIENT_KEYS` array so `install.sh` writes it to
   `~/.remote-pair/client.env`.

4. **Host shell editor tab** — whatever surface hosts the editor tab should
   point to `http://127.0.0.1:${EDITOR_PORT}`. It should call
   `remote-pair-editor start <folder>` before loading the editor URL, and
   surface the status check from `remote-pair-editor status`.
