# M-Mount — Host Folder Mount Option

Mount-based file access is an **alternative** to Syncthing for the RemotePair file-access layer.
Instead of syncing a local copy, the client mounts the host folder directly so there is a single
source of truth — no sync daemon, no conflict files, no `.sync-conflict-*` clutter.

**Status:** `client/cli/remote-pair-mount` launcher is complete and works for both backends (SMB and
SSHFS mount/unmount/status). Wizard, config, and doctor wiring are a follow-up pass (see
Integration Contract below).

---

## When to use Mount vs Syncthing

| | Mount | Syncthing |
|---|---|---|
| **Source of truth** | Single (host) — no copies | Dual (host + client) — synced |
| **Read latency** | Network round-trip per read (SMB: ~1-5 ms LAN; SSHFS: SSH overhead) | Near-zero (local copy) |
| **Write latency** | Network round-trip per write | Near-zero (local), synced async |
| **Offline editing** | Not possible — host must be reachable | Possible, synced on reconnect |
| **Conflict risk** | Zero — only one copy exists | Exists (concurrent edits on both machines) |
| **Daemon required** | No (SMB: OS-level; SSHFS: macFUSE kext, one-time setup) | Yes (Syncthing running on both sides) |
| **Best for** | Browsing, reading, occasional edits; zero-conflict CI/build output workflows | Heavy interactive editing with claude running locally |

**Rule of thumb:** if you're using RemotePair primarily to run claude on the host (the normal case),
Syncthing's local copy means claude reads files at disk speed and is the better default. Choose Mount
when you want a single authoritative copy — e.g. the host is the only machine that should write, or
you're viewing large generated artifacts and don't want them synced locally.

---

## Backend comparison

| Backend | Mechanism | Client dependencies | Host prerequisites | Kernel extension? |
|---|---|---|---|---|
| **SMB** (default) | `mount_smbfs` — ships with macOS | None (built-in) | File Sharing ON in System Settings > General > Sharing; target folder added to shared list | No |
| **SSHFS** | `sshfs` over existing SSH key trust | macFUSE kext + `sshfs-mac` (one-time install + Security approval) | SSH access (already required by RemotePair) | Yes — macFUSE |
| **NFS** (note only) | `mount_nfs` — ships with macOS | None (built-in) | `nfsd` enabled on host + `/etc/exports` configured | No (macOS NFS client is built-in) |

NFS is not implemented in the launcher because host export configuration is fiddly (requires
editing `/etc/exports` and running `nfsd enable`). It can be added later if there is demand.

### SMB details

SMB is the recommended default on macOS-to-macOS LAN connections. macOS File Sharing runs an
SMB server automatically when enabled. No kernel extension is needed on either side. The share
name defaults to the basename of the shared folder (macOS registers it automatically).

Host one-time step (analogous to TCC grants — cannot be automated from the client):

> **System Settings > General > Sharing > File Sharing** — toggle ON, then click the `+` button
> and add the folder(s) you want to share.

### SSHFS details

SSHFS reuses the SSH key trust that RemotePair already requires, so no new credential setup is
needed on the host. The client-side setup requires a kernel extension (macFUSE):

```
brew install --cask macfuse
# → System Settings > Privacy & Security > scroll down → Allow "macFUSE" → reboot if prompted
brew install gromgit/fuse/sshfs-mac
```

If `sshfs` or macFUSE is absent, `remote-pair-mount` prints the above instructions and exits
non-zero — it will never attempt to install kernel extensions automatically.

---

## Usage

```
# Mount a host path (SMB by default)
remote-pair-mount mount /Users/alice/Projects/foo

# Mount with explicit backend
remote-pair-mount --backend sshfs mount /Users/alice/Projects/foo

# Mount with a custom local mountpoint
remote-pair-mount mount /Users/alice/Projects/foo ~/mnt/foo

# List active RemotePair mounts
remote-pair-mount status

# Unmount by mountpoint or host path
remote-pair-mount unmount ~/mnt/foo
remote-pair-mount unmount /Users/alice/Projects/foo   # resolves to default mountpoint

# Help
remote-pair-mount help
```

Default mountpoint: `~/.remote-pair/mounts/<host>/<sanitized-hostpath>`

After mounting, point a FOLDER_MAPS entry at the mountpoint so path mapping in `remote-pair-launch`
resolves correctly:

```
# In ~/.remote-pair/client.env — add or update FOLDER_MAPS
FOLDER_MAPS="/Users/me/LocalProjects::~/.remote-pair/mounts/my-host/Users_alice_Projects"
```

---

## Integration contract (wiring pass — follow-up)

The launcher is self-contained. The items below are for a subsequent agent pass that wires it into
the rest of the system. No existing files should be edited until this contract is agreed.

### (a) `shared/config.sh` — new keys

```bash
# File-access backend: syncthing (default) or mount.
SYNC_BACKEND="${SYNC_BACKEND:-syncthing}"   # add to CLIENT_KEYS array

# Mount backend when SYNC_BACKEND=mount: smb (default) or sshfs.
MOUNT_BACKEND="${MOUNT_BACKEND:-smb}"       # add to CLIENT_KEYS array
```

Add both to `CLIENT_KEYS` in `config.sh`:
```bash
CLIENT_KEYS=(REMOTE_HOST FOLDER_MAPS LAUNCHER TERMINAL_APP WEB_DIR WEB_BIND WEB_PORT EDITOR_PORT SYNC_BACKEND MOUNT_BACKEND)
```

### (b) `shared/install.sh` — install the launcher

In the `--role client` install block, alongside `remote-pair-launch` and `remote-pair-desktop`:

```bash
install_file "$CLIENT_DIR/remote-pair-mount" "$LOCAL_BIN/remote-pair-mount" 755
```

### (c) `client/cli/remote-pair` — add `mount` subcommand

In the main CLI's subcommand dispatch (wherever `desktop` delegates to `remote-pair-desktop`),
add:

```bash
mount|unmount) exec "$LOCAL_BIN/remote-pair-mount" "$@" ;;
```

So `remote-pair mount ...` and `remote-pair unmount ...` delegate to the launcher.

### (d) Onboarding

Onboarding is to be implemented as two Electron windows (host in RemotePairHost, client in the
RemotePair IDE), based on the mockup — not yet built; the prior browser-based web wizard was
removed. The folder-mapping / Syncthing step of that onboarding should add a "File access method"
choice:

- **Syncthing** (default) — installs Syncthing, configures folder sync, existing flow.
- **Mount** — skips Syncthing install; calls `remote-pair-mount mount <hostPath>` for each
  configured folder; writes `SYNC_BACKEND=mount` + `MOUNT_BACKEND=smb|sshfs` to `client.env`;
  shows SMB/SSHFS prerequisite instructions (host File Sharing or macFUSE) inline.

Whatever onboarding surface drives this should run `remote-pair-mount mount <hostPath> [mountpoint]`
and surface the resolved mountpoint path to the user.

### (e) Doctor check (`remote-pair doctor`)

When `SYNC_BACKEND=mount`:

- Skip the Syncthing running/connected check.
- Instead, for each FOLDER_MAPS entry whose client path is under `~/.remote-pair/mounts/`,
  verify the mountpoint is active: `remote-pair-mount status` (or `mount | grep <mountpoint>`).
- Warn with remediation hint if a configured mount is not active.

---

## Files

| Path | Role |
|---|---|
| `client/cli/remote-pair-mount` | Launcher script (mount/unmount/status/help, SMB + SSHFS) |
| `docs/m-mount.md` | This document |
