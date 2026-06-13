# Connect to your host

RemotePair drives a remote macOS **host** machine. The client (this IDE) talks
to the host over SSH using the `REMOTE_HOST` value in `~/.remote-pair/client.env`.

- **Connect to Host** opens the host filesystem in a new window via *Open Remote - SSH*.
- The **Remote Desktop** view (RemotePair icon in the activity bar) streams the
  host screen and forwards your clicks/keys.

If nothing happens, confirm you can `ssh <REMOTE_HOST>` from a terminal without a
password prompt.
