# RemotePair PIN Pairing — PAKE Wire Protocol (v1)

This is the **single source of truth** for the RemotePair PIN pairing handshake.
The protocol — not any one language — is normative. Two build artifacts implement
it from one Rust crate (`host/rd/pake`):

- **Host C-ABI staticlib** (`libpake.a`) linked by Swift `PairingServer.swift`
  (Component B2). Swift owns sockets + lifecycle; **all** crypto/group math is in
  the staticlib.
- **Client binary** `remote-pair-pake` (Component P3) that the bash CLI
  `remote-pair pair` verb (Component C2) shells to.

Both consume the **same committed interop vectors** (`vectors/*.txt`). A drift in
framing, suite, transcript layout, or KDF makes a vector mismatch and fails CI on
both sides.

---

## 1. Cryptographic suite

| Element             | Choice                                                            |
| ------------------- | ---------------------------------------------------------------- |
| PAKE                | **SPAKE2**, RustCrypto `spake2 = 0.4` (MIT OR Apache-2.0)        |
| Group               | **Ed25519** (`curve25519-dalek`, BSD-3-Clause)                  |
| Shared secret       | the **6-digit PIN** displayed on the host screen                 |
| KDF                 | **HKDF-SHA256**                                                  |
| Confirmation MAC    | **HMAC-SHA256** (32 bytes), constant-time compared (`subtle`)    |
| Channel binding     | **SHA256(transcript)** (32 bytes)                               |
| Suite ID string     | `RemotePair-PAKE-v1 SPAKE2-Ed25519 HKDF-SHA256 HMAC-SHA256`      |
| `PROTOCOL_VERSION`  | **1** (single version byte; bump on ANY breaking change)         |

SPAKE2 roles: **A = host** (identity `RemotePair-host`), **B = client**
(identity `RemotePair-client`). The SPAKE2 password element is domain-separated:
`password = SUITE_ID || 0x00 || PIN_ascii`.

### License gate (ADR Fork #1) — PASSED

`cargo deny check licenses` over the full tree returns **`licenses ok`**. Every
dependency is permissive (`spake2` MIT/Apache-2.0, `curve25519-dalek`
BSD-3-Clause, `subtle` BSD-3-Clause, all RustCrypto MIT/Apache-2.0). The guarded
"password-path-only" fallback is **NOT** taken; the primary PIN/PAKE path ships.

---

## 2. Framing

Every message on the wire is a single **bare length-prefixed** frame — a 2-byte
big-endian payload length followed by the payload. There is NO per-frame version
or type byte; ordering is positional (see §3). This matches the host
`PairingServer.swift` framed I/O exactly.

```
+------------------+----------------------+
| length (u16, BE) | payload (length B)   |
|     2 bytes      |                      |
+------------------+----------------------+
```

- `length` is big-endian; payloads are bounded (both ends reject `0` and `> 8192`).
- The version is pinned by the suite/transcript (`PROTOCOL_VERSION` is mixed into
  the MAC transcript, §4), so a version skew makes every MAC fail to verify.

A SPAKE2 Ed25519 message is **33 bytes** (1 type byte + 32-byte group element);
a confirmation MAC is **32 bytes**.

---

## 3. Handshake sequence (positional frames)

```
host (A, staticlib via Swift)                client (B, remote-pair-pake)
------------------------------------------------------------------------
pake_server_start(pin, host_fp)
  (1) -> frame[msg_host] ------------------> recv frame -> msg_host
                                            client_run(pin, fp, msg_host)
  (2) recv frame  <------------------------- frame[msg_client]
pake_server_step(handle, msg_client)
  (3) -> frame[host_mac] ------------------> recv frame -> host_mac
                                            verify_mac(expect_host_mac, host_mac)
                                            ==> FAIL -> exit non-zero (closed)
  (4) recv frame  <------------------------- frame[client_mac]   (only after host
                                                                  MAC verified)
pake_verify_mac(expect_client_mac,
                client_mac)  ==> OK  (authn-before-touch gate; MUST pass
                                      before ANY ~/.ssh access)
  (5) recv frame  <------------------------- frame[pubkey line]  (post-MAC only)
      appendAuthorizedKey(pubkey)            (host touches ~/.ssh ONLY here)
  (6) -> frame[{"ok":bool,"msg":str}] -----> recv frame -> result
                                            exit 0 iff "ok":true, else non-zero
```

Both confirmation MACs are exchanged BEFORE the pubkey: the client verifies the
host (frame 3) and only then sends its own MAC (frame 4); the host verifies the
client (the authn-before-touch gate) and only then reads the pubkey (frame 5).

---

## 4. Transcript and the fingerprint binding

The confirmation MAC keys are derived over a transcript that **mixes in the host
SSH-key SHA256 fingerprint as the binding**. This is what cryptographically ties
the PAKE channel to the exact host the client will SSH to (anti-MITM; the same
`fp` is the SSH-TOFU cross-check on first connect, Component B1).

Transcript (length-prefixed; `lp(x) = u16-BE len || x`):

```
transcript = SUITE_ID
          || PROTOCOL_VERSION (1 byte)
          || lp(host_fp_raw)     // 32-byte raw SHA256 of the ssh-ed25519 host key
          || lp(msg_host)        // frame 1 payload (host SPAKE2 message)
          || lp(msg_client)      // frame 2 payload (client SPAKE2 message)
```

Key schedule (`shared_key` = SPAKE2 `finish()` output, identical on both sides
iff the PINs matched):

```
hk          = HKDF-SHA256(salt = transcript, ikm = shared_key)
k_host      = hk.expand(SUITE_ID || " |confirm-host",   32)
k_client    = hk.expand(SUITE_ID || " |confirm-client", 32)
host_mac    = HMAC-SHA256(k_host,   transcript)   // host proves knowledge
client_mac  = HMAC-SHA256(k_client, transcript)   // client proves knowledge
channel     = SHA256(transcript)                  // 32-byte channel binding
```

Two directional MACs give explicit **mutual** key confirmation; neither MAC is
reusable as the other. Because `host_fp` is inside the transcript, a wrong/forged
fingerprint changes every MAC → verification fails closed even when the PIN is
correct.

**Fail-closed invariant:** wrong PIN, expired PIN, and tampering are
**indistinguishable** — all produce a MAC that fails `verify_mac` (constant
time). The error surface never reveals which.

---

## 5. CONTRACT — `remote-pair-pake` (client binary)

The CLI `pair` verb (`cmd_pair`, `client/cli/remote-pair`) integrates against
this exact interface. **Stable** — it is what the already-written caller invokes:

```
remote-pair-pake --host <ADDR> --pin <PIN> --expect-fp <FP> --pubkey <LINE>
```

| arg                  | meaning                                                        |
| -------------------- | ------------------------------------------------------------- |
| `--host <ADDR>`      | host LAN address. The fixed pairing port **53427** is appended automatically; `ADDR:PORT` is also accepted. |
| `--pin <PIN>`        | the 6-digit code shown on the host screen                     |
| `--expect-fp <FP>`   | expected host-key fp: `SHA256:<base64>` (the form `rp_norm_fp` emits) OR 64-char lowercase hex. (alias `--fp`) |
| `--pubkey <LINE>`    | the client's `~/.ssh/id_ed25519.pub` line; sent to the host ONLY after the host MAC verifies (frame 5). |

The binary owns the **full handshake** (frames 1–6 of §3): SPAKE2 with the PIN,
the host-fp binding (anti-MITM), mutual MAC confirmation, and the post-MAC pubkey
handoff. It reads the host's result frame and maps it to the exit code.

**stdin:** none. **stdout:** none. **stderr:** on failure, generic
`pairing failed` (never reveals which); on success it may relay the host's `msg`
(e.g. "Enable Remote Login on the host to finish"). The PIN never appears on any
stream, log, or telemetry.

**exit codes** (= `pake::codes`, also the C-ABI return values):

| code | meaning                                                          |
| ---- | --------------------------------------------------------------- |
| 0    | OK — PAKE confirmed AND host authorized the pubkey (`"ok":true`) |
| 2    | bad message / framing                                           |
| 3    | SPAKE2 finish failed (malformed peer element)                   |
| 4    | **MAC mismatch / host rejected** — wrong PIN / expired PIN / fp mismatch / tampering / `"ok":false` (all indistinguishable) |
| 5    | bad arguments                                                   |
| 6    | I/O error (connect/read/write/timeout)                         |

**downstream wiring (what `remote-pair pair` does):** it passes `--expect-fp`
(normalized by `rp_norm_fp`) and `--pubkey "$(rp_ssh_pubkey)"`. On exit 0 it
writes the managed `~/.ssh/config` block (Component C4) and persists
`REMOTE_HOST`. On any non-zero exit it surfaces "pairing failed (wrong/expired
PIN, fp mismatch, or host re-armed)" and writes no config. The host-key SSH-TOFU
cross-check against the same `fp` happens on the first real `ssh` connection.

The `channel_binding` value (`SHA256(transcript)`, §4) is exposed as a public
crate API (`pake::channel_binding`) for callers that want to key/verify an
out-of-band step; it is not printed by the binary in the pubkey-handoff flow
(the host completes the handoff in-band over the confirmed socket).

**hidden interop self-test** (CI; replays committed vectors through the same
crate logic the network path uses):

```
remote-pair-pake --selftest-vectors <DIR>   # exit 0 = all vectors pass
```

---

## 6. CONTRACT — C ABI (host staticlib, for `PairingServer.swift`)

Link `target/release/libpake.a`. Canonical header: **`host/app/pake-bridge.h`**
(imported by `host/build-host.sh` via `-import-objc-header`; it mirrors
`src/ffi.rs` exactly). The host is SPAKE2 side A. **authn-before-touch:** Swift
MUST get `PAKE_OK` from `pake_verify_mac` on the client's MAC **before** it reads
the client pubkey or touches `~/.ssh/*`.

```c
// Begin the host PAKE. host_fp_ptr -> 32 raw SHA256 bytes of the ssh-ed25519
// host key. out_msg gets msg_host (<= PAKE_MSG_MAX bytes). Returns 0 (OK) or a
// pake code; on non-OK *out_handle is NULL.
int32_t pake_server_start(
    const uint8_t *pin_ptr, size_t pin_len,
    const uint8_t *host_fp_ptr,            // exactly 32 bytes
    PakeServerHandle **out_handle,
    uint8_t *out_msg, size_t out_msg_cap, size_t *out_msg_len);

// Consume the client's SPAKE2 message; derive the MACs. On OK the handle is
// CONSUMED+freed. out_send_mac = MAC to send to the client (SERVER_MAC).
// out_expect_mac = MAC the client's CLIENT_MAC must equal (pass both to
// pake_verify_mac). out_key (optional) = shared key. Returns 0 (OK) or a code.
int32_t pake_server_step(
    PakeServerHandle *handle,
    const uint8_t *msg_client_ptr, size_t msg_client_len,
    uint8_t *out_send_mac,                 // >= PAKE_MAC_LEN
    uint8_t *out_expect_mac,               // >= PAKE_MAC_LEN
    uint8_t *out_key, size_t out_key_cap, size_t *out_key_len);

// Constant-time MAC compare. 0 (OK) on match, 4 (MAC mismatch) otherwise.
// THE authn-before-touch gate.
int32_t pake_verify_mac(
    const uint8_t *expected_ptr, size_t expected_len,  // expected_len == PAKE_MAC_LEN
    const uint8_t *got_ptr, size_t got_len);

// Free a handle NOT consumed by a successful pake_server_step (error/timeout/
// disarm). NULL-safe.
void pake_server_free(PakeServerHandle *handle);
```

Constants (also in `host/app/pake-bridge.h`): `PAKE_MSG_MAX = 33`, `PAKE_MAC_LEN = 32`,
`PAKE_KEY_MAX = 33`. Return/exit codes: `PAKE_OK=0`, `PAKE_BAD_MESSAGE=2`,
`PAKE_SPAKE_FAILED=3`, `PAKE_MAC_MISMATCH=4`, `PAKE_BAD_ARGS=5`,
`PAKE_IO_ERROR=6`.

---

## 7. Interop vectors (`vectors/*.txt`)

Plain `key = value` (one vector per file, `#` comments, hex byte fields).
Because SPAKE2 messages are randomized, each vector PINS the RNG (`seed_a`,
`seed_b`) and records expected `msg_host`, `msg_client`, `host_mac`,
`client_mac`, `shared_key`, `channel`. Regenerate ONLY on a deliberate protocol
change (and bump `PROTOCOL_VERSION`):

```
cargo run --example gen_vectors        # rewrites vectors/*.txt
```

The vectors are **replayed, not regenerated** by `cargo test -p pake`
(`tests::committed_vectors_match`, the host link path) and by
`remote-pair-pake --selftest-vectors ./vectors` (the client binary). Both must
agree on identical bytes.
