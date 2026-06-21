# Xpair

Turns the **Xpair IDE** (a VSCodium fork) into a xpair **client** for
a macOS **host** running `XpairHost.app`.

The IDE is the client; the host is a separate Mac reached over SSH
(`REMOTE_HOST` in `~/.xpair/host/client.env`). Xpair reuses the host's
proven **InputServer** file channel — no extra agent to install on the host.

## Features

- **Remote Desktop** — a live view of the host screen in the activity bar,
  refreshed about once a second by polling the host's screenshot primitive.
- **Input forwarding** — click on the image to click the host; type to send key
  combos (coarse v0; toggle with the title-bar button or
  *Xpair: Toggle Input Forwarding*).
- **Connect to Host** — opens the host filesystem over *Open Remote - SSH* in
  one click (uses `REMOTE_HOST`).
- **Host notifications** — surfaces queued host notifications
  (`~/.xpair/host/notifications/queue.jsonl`) as IDE messages, optionally
  filtered by `~/.xpair/host/notify.conf` `ENABLED_TYPES`.
- **First-run bootstrap** — installs Claude Code, ChatGPT and Open Remote - SSH
  from the configured gallery if missing.

## How it works

The host's `XpairHost.app` exposes an InputServer over two temp files:
write a request to `/tmp/xpair.input-req`, read the reply from
`/tmp/xpair.input-res`.

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
- `XpairHost.app` running on the host with Screen Recording and
  Accessibility granted (host-side — see the walkthrough).

## Configuration

`~/.xpair/host/client.env`:

```
REMOTE_HOST=gh-mac-m1
```

`~/.xpair/host/notify.conf` (optional):

```
ENABLED_TYPES=approval,error
```

## Commands

- `Xpair: Connect to Host`
- `Xpair: Refresh Remote Desktop`
- `Xpair: Toggle Input Forwarding`
- `Xpair: Install AI Extensions`

## License

MIT
