# RemotePair

Turns the **RemotePair IDE** (a VSCodium fork) into a remote-pair **client** for
a macOS **host** running `RemotePairHost.app`.

The IDE is the client; the host is a separate Mac reached over SSH
(`REMOTE_HOST` in `~/.remote-pair/client.env`). RemotePair reuses the host's
proven **InputServer** file channel — no extra agent to install on the host.

## Features

- **Remote Desktop** — a live view of the host screen in the activity bar,
  refreshed about once a second by polling the host's screenshot primitive.
- **Input forwarding** — click on the image to click the host; type to send key
  combos (coarse v0; toggle with the title-bar button or
  *RemotePair: Toggle Input Forwarding*).
- **Connect to Host** — opens the host filesystem over *Open Remote - SSH* in
  one click (uses `REMOTE_HOST`).
- **Host notifications** — surfaces queued host notifications
  (`~/.remote-pair/notifications/queue.jsonl`) as IDE messages, optionally
  filtered by `~/.remote-pair/notify.conf` `ENABLED_TYPES`.
- **First-run bootstrap** — installs Claude Code, ChatGPT and Open Remote - SSH
  from the configured gallery if missing.

## How it works

The host's `RemotePairHost.app` exposes an InputServer over two temp files:
write a request to `/tmp/remote-pair.input-req`, read the reply from
`/tmp/remote-pair.input-res`.

| Request | Effect | Reply |
| --- | --- | --- |
| `shot\t<path>` | write a screenshot PNG to `<path>` | `ok\t<path>` |
| `click\t<x>\t<y>` | click at host display pixels | — |
| `key\t<combo>` | send a key combo | — |

The extension does this over SSH with **argv-safe** `spawn` calls. `REMOTE_HOST`
is validated against `^[A-Za-z0-9._-]+$` before it is ever used, so it cannot
inject SSH options or shell metacharacters.

## Requirements

- Passwordless SSH from this client to `REMOTE_HOST` (`BatchMode=yes` must work).
- `RemotePairHost.app` running on the host with Screen Recording and
  Accessibility granted (host-side — see the walkthrough).

## Configuration

`~/.remote-pair/client.env`:

```
REMOTE_HOST=gh-mac-m1
```

`~/.remote-pair/notify.conf` (optional):

```
ENABLED_TYPES=approval,error
```

## Commands

- `RemotePair: Connect to Host`
- `RemotePair: Refresh Remote Desktop`
- `RemotePair: Toggle Input Forwarding`
- `RemotePair: Install AI Extensions`

## License

MIT
