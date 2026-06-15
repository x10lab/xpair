# Set up file access

Choose how this client reaches the host's files. Pick **one** primary backend:

- **Open Remote - SSH (recommended)** — edit the host filesystem *directly*, no
  syncing. **Connect to Host** opens the host's folders and a terminal attached
  to the host's `tmux-aqua` session (where Claude runs). Nothing to map.

- **Folder mapping + sync** — keep a local copy that stays in sync with the host
  (Syncthing by default). Register which local folder maps to which host folder so
  the launcher knows where each project lives on the host.

- **Mount** — mount a host folder onto this client over `smb`/`sshfs`
  (`SYNC_BACKEND=mount`), an alternative to Syncthing.

**Run setup** configures all of this interactively (host, terminal app, **folder
mapping**, and a doctor check) via the `remote-pair onboard` CLI. You can also run
these directly in a terminal:

```
remote-pair onboard                      # interactive: host + folder mapping + doctor
remote-pair map add <localDir> <hostDir> # register one mapping (omit hostDir = same path)
remote-pair mount mount <hostPath>       # mount a host folder (smb/sshfs)
remote-pair mount status                 # show active mounts
```

Mappings persist in `~/.remote-pair/client.env` (`FOLDER_MAPS`). Re-run
`remote-pair onboard` anytime to change them.
