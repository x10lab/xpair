# Connect to your host

RemotePair drives a remote macOS **host** machine. The client (this IDE) talks
to the host over SSH using the `REMOTE_HOST` value in `~/.remote-pair/client.env`.

- **Connect to Host** opens the host filesystem in a new window via *Open Remote - SSH*.
- The **Remote Desktop** opens as a pinned editor tab (**RD**) in the main editor
  area — it streams the host screen and forwards your clicks/keys. Reopen it
  anytime with **RemotePair: Open Remote Desktop** from the Command Palette.

If nothing happens, confirm you can `ssh <REMOTE_HOST>` from a terminal without a
password prompt.
