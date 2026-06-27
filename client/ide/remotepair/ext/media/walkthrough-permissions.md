# Permissions are host-side

Xpair captures the screen **on the host machine**, not on this client. All the
macOS privacy grants live on the host:

- **Screen Recording** — required for the Remote Desktop image.
- **Accessibility** — required by host-side computer-use sessions, not by the
  IDE Remote Desktop view itself.
- **Files & Folders / Full Disk Access** — for the folders you open over SSH.

These are granted to **XpairHost.app** on the host in
*System Settings ▸ Privacy & Security*. If the Remote Desktop is blank, check
those grants on the host — there is nothing to approve on this client.
