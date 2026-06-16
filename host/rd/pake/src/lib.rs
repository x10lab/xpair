//! RemotePair PAKE helper — SPAKE2 (Ed25519 group, RustCrypto `spake2` crate)
//! bound to the host's SSH host-key SHA256 fingerprint.
//!
//! The wire format and all binding rules are specified ONCE in `PROTOCOL.md`;
//! this crate is the single implementation behind both build artifacts:
//!   * the host C-ABI staticlib (`ffi` module) linked by Swift `PairingServer`;
//!   * the client `remote-pair-pake` binary (`src/bin/remote-pair-pake.rs`).
//! Both consume the SAME committed interop vectors (`vectors/`) in tests, so a
//! wire-format drift between host and client fails CI.
//!
//! ## Security model (see PROTOCOL.md for the normative spec)
//! * Shared low-entropy secret = the 6-digit PIN shown on the host screen.
//! * SPAKE2 turns the PIN into a high-entropy shared key WITHOUT revealing it,
//!   so an online attacker gets exactly ONE guess per connection (rate-limited
//!   + PIN-burn on the host) and an offline dictionary attack is impossible.
//! * The host-key fingerprint is mixed into the confirmation-MAC transcript as
//!   AAD, cryptographically BINDING the PAKE channel to the specific host the
//!   client will SSH to (closes the MITM/relay gap; the same fp is the SSH-TOFU
//!   cross-check on first connect).
//! * Confirmation MACs are compared in constant time (`subtle`). A wrong PIN and
//!   an expired PIN are indistinguishable to the client: both yield a MAC that
//!   fails to verify.

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use subtle::ConstantTimeEq;

/// Wire-format version byte. Bumped on ANY breaking change to framing, the
/// SPAKE2 suite, the transcript layout, or the KDF/MAC construction.
pub const PROTOCOL_VERSION: u8 = 1;

/// Suite identifier mixed into the KDF `info` / transcript. Pins the concrete
/// primitives so a future suite cannot be confused for this one.
pub const SUITE_ID: &[u8] = b"RemotePair-PAKE-v1 SPAKE2-Ed25519 HKDF-SHA256 HMAC-SHA256";

/// SPAKE2 identity labels. They bind each side's role into the SPAKE2 transcript
/// itself (asymmetric A/B flow): A = host (server), B = client.
pub const ID_HOST: &[u8] = b"RemotePair-host";
pub const ID_CLIENT: &[u8] = b"RemotePair-client";

/// Length of a confirmation MAC (HMAC-SHA256) in bytes.
pub const MAC_LEN: usize = 32;

type HmacSha256 = Hmac<Sha256>;

/// Errors surfaced across the API and the C ABI. Kept coarse on purpose: the
/// client must NOT be able to distinguish "wrong PIN" from "expired PIN" from
/// "tampered message" — all of those collapse to `MacMismatch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PakeError {
    /// An inbound wire message had the wrong length / framing.
    BadMessage,
    /// SPAKE2 `finish` rejected the peer message (malformed element, etc.).
    SpakeFailed,
    /// The confirmation MAC did not verify (wrong/expired PIN or tampering).
    /// Fail-closed: callers treat this as a hard, indistinguishable failure.
    MacMismatch,
}

/// Numeric error codes for the C ABI (also the process exit codes of the client
/// binary). Stable contract — do not renumber.
pub mod codes {
    pub const OK: i32 = 0;
    pub const BAD_MESSAGE: i32 = 2;
    pub const SPAKE_FAILED: i32 = 3;
    pub const MAC_MISMATCH: i32 = 4;
    pub const BAD_ARGS: i32 = 5;
    pub const IO_ERROR: i32 = 6;
}

impl PakeError {
    pub fn code(self) -> i32 {
        match self {
            PakeError::BadMessage => codes::BAD_MESSAGE,
            PakeError::SpakeFailed => codes::SPAKE_FAILED,
            PakeError::MacMismatch => codes::MAC_MISMATCH,
        }
    }
}

/// Parse an `ssh-keygen -lf` style fingerprint (`SHA256:<base64...>`) OR a bare
/// 64-char lowercase-hex SHA256 into the raw 32 binary digest bytes. Both forms
/// are accepted so the caller can pass whichever it already has; the RAW bytes
/// are what gets mixed into the transcript, so the textual form is irrelevant to
/// the binding.
pub fn parse_host_fp(fp: &str) -> Result<[u8; 32], PakeError> {
    let fp = fp.trim();
    if let Some(b64) = fp.strip_prefix("SHA256:") {
        // ssh-keygen base64 is unpadded standard alphabet.
        let raw = b64_decode(b64.trim_end_matches('=')).ok_or(PakeError::BadMessage)?;
        if raw.len() != 32 {
            return Err(PakeError::BadMessage);
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&raw);
        Ok(out)
    } else {
        let raw = hex::decode(fp).map_err(|_| PakeError::BadMessage)?;
        if raw.len() != 32 {
            return Err(PakeError::BadMessage);
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&raw);
        Ok(out)
    }
}

/// Minimal standard-alphabet base64 decoder (no padding required). Avoids adding
/// a base64 crate to the firewall just to parse the ssh-keygen fp form. Uses a
/// bit accumulator: shift in 6 bits per symbol, emit a byte each time >= 8 bits
/// are buffered.
fn b64_decode(s: &str) -> Option<Vec<u8>> {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let val = |c: u8| -> Option<u32> { A.iter().position(|&x| x == c).map(|p| p as u32) };
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let mut out = Vec::with_capacity(s.len() * 3 / 4 + 1);
    for c in s.bytes() {
        if c.is_ascii_whitespace() || c == b'=' {
            continue;
        }
        acc = (acc << 6) | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// The transcript over which the confirmation MAC key is derived. Mixing the
/// host fingerprint here is the cryptographic BINDING required by the spec.
///
/// Layout (length-prefixed so no field can be confused for another):
///   SUITE_ID
///   || VERSION
///   || lp(host_fp_raw)          (32-byte SHA256 of the ssh-ed25519 host key)
///   || lp(msg_host)             (SPAKE2 message sent by the host / side A)
///   || lp(msg_client)           (SPAKE2 message sent by the client / side B)
/// where lp(x) = u16-be length || x.
fn transcript(host_fp: &[u8; 32], msg_host: &[u8], msg_client: &[u8]) -> Vec<u8> {
    let mut t = Vec::new();
    t.extend_from_slice(SUITE_ID);
    t.push(PROTOCOL_VERSION);
    push_lp(&mut t, host_fp);
    push_lp(&mut t, msg_host);
    push_lp(&mut t, msg_client);
    t
}

fn push_lp(buf: &mut Vec<u8>, x: &[u8]) {
    buf.extend_from_slice(&(x.len() as u16).to_be_bytes());
    buf.extend_from_slice(x);
}

/// Public, stable channel-binding value: `SHA256(transcript)`. The CLI and the
/// Swift host both compute this independently; it keys/labels the post-MAC pubkey
/// transfer so the confirmed channel cannot be spliced onto a different PAKE run.
/// 32 bytes, hex-encoded on the `remote-pair-pake` stdout `CHANNEL` line.
pub fn channel_binding(host_fp: &[u8; 32], msg_host: &[u8], msg_client: &[u8]) -> [u8; 32] {
    let t = transcript(host_fp, msg_host, msg_client);
    let mut h = Sha256::new();
    h.update(&t);
    let out = h.finalize();
    let mut buf = [0u8; 32];
    buf.copy_from_slice(&out);
    buf
}

/// Derive the two directional confirmation MACs from the SPAKE2 shared key.
///
/// `shared_key` is the raw output of SPAKE2 `finish()` (identical on both sides
/// iff the PINs matched). We HKDF-expand it, salted by the transcript, into two
/// independent HMAC keys, then MAC the transcript in each direction. Two MACs
/// (not one) give explicit mutual key confirmation: host proves it to client,
/// client proves it to host, neither MAC reusable as the other.
pub struct Confirmation {
    /// MAC the HOST sends to the CLIENT (host proves knowledge).
    pub host_mac: [u8; MAC_LEN],
    /// MAC the CLIENT sends to the HOST (client proves knowledge).
    pub client_mac: [u8; MAC_LEN],
}

pub fn derive_confirmation(
    shared_key: &[u8],
    host_fp: &[u8; 32],
    msg_host: &[u8],
    msg_client: &[u8],
) -> Confirmation {
    let t = transcript(host_fp, msg_host, msg_client);
    // HKDF-Extract+Expand: salt = transcript, ikm = SPAKE2 key, info = suite|label.
    let hk = Hkdf::<Sha256>::new(Some(&t), shared_key);

    let mut k_host = [0u8; 32];
    hk.expand(&[SUITE_ID, b" |confirm-host"].concat(), &mut k_host)
        .expect("32 is a valid HKDF length");
    let mut k_client = [0u8; 32];
    hk.expand(&[SUITE_ID, b" |confirm-client"].concat(), &mut k_client)
        .expect("32 is a valid HKDF length");

    let host_mac = mac(&k_host, &t);
    let client_mac = mac(&k_client, &t);
    Confirmation { host_mac, client_mac }
}

fn mac(key: &[u8; 32], data: &[u8]) -> [u8; MAC_LEN] {
    let mut m = <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    m.update(data);
    let out = m.finalize().into_bytes();
    let mut buf = [0u8; MAC_LEN];
    buf.copy_from_slice(&out);
    buf
}

/// Constant-time confirmation-MAC check. Returns `Ok(())` on match, else
/// `MacMismatch`. Used to verify the PEER's MAC; never branch on the result
/// before this returns (fail-closed).
pub fn verify_mac(expected: &[u8; MAC_LEN], got: &[u8]) -> Result<(), PakeError> {
    if got.len() != MAC_LEN {
        return Err(PakeError::MacMismatch);
    }
    if expected.ct_eq(got).into() {
        Ok(())
    } else {
        Err(PakeError::MacMismatch)
    }
}

/// SPAKE2 password = PIN bytes mixed with the suite id (domain separation so the
/// same PIN under a different suite/version yields a different password element).
fn pin_password(pin: &str) -> Password {
    let mut p = Vec::new();
    p.extend_from_slice(SUITE_ID);
    p.push(0);
    p.extend_from_slice(pin.trim().as_bytes());
    Password::new(p)
}

/// Host (side A) PAKE state. Holds the in-progress SPAKE2 plus the data needed
/// to build the binding transcript once the client message arrives.
pub struct ServerSession {
    spake: Option<Spake2<Ed25519Group>>,
    msg_host: Vec<u8>,
    host_fp: [u8; 32],
}

/// Result of the host completing the PAKE: the MAC to SEND to the client and the
/// MAC to EXPECT from the client.
pub struct ServerFinished {
    /// Sent to the client so the client can verify the host.
    pub send_host_mac: [u8; MAC_LEN],
    /// The client's MAC must equal this (verify in constant time).
    pub expect_client_mac: [u8; MAC_LEN],
    /// The SPAKE2 shared key (high-entropy session secret) for later channel use.
    pub shared_key: Vec<u8>,
}

impl ServerSession {
    /// Begin the PAKE as the host. `pin` is the displayed 6-digit code; `host_fp`
    /// is the raw 32-byte SHA256 of the ssh-ed25519 host key. Returns the session
    /// and the SPAKE2 message to send to the client.
    pub fn start(pin: &str, host_fp: [u8; 32]) -> (ServerSession, Vec<u8>) {
        Self::start_with_rng(pin, host_fp, rand_core::OsRng)
    }

    /// Deterministic variant for interop vectors (caller supplies the RNG).
    pub fn start_with_rng(
        pin: &str,
        host_fp: [u8; 32],
        rng: impl rand_core::CryptoRng + rand_core::RngCore,
    ) -> (ServerSession, Vec<u8>) {
        let (spake, msg_host) = Spake2::<Ed25519Group>::start_a_with_rng(
            &pin_password(pin),
            &Identity::new(ID_HOST),
            &Identity::new(ID_CLIENT),
            rng,
        );
        let session = ServerSession {
            spake: Some(spake),
            msg_host: msg_host.clone(),
            host_fp,
        };
        (session, msg_host)
    }

    /// Consume the client's SPAKE2 message, finish the key agreement, and derive
    /// the confirmation MACs bound to the host fingerprint.
    pub fn step(mut self, msg_client: &[u8]) -> Result<ServerFinished, PakeError> {
        if msg_client.is_empty() {
            return Err(PakeError::BadMessage);
        }
        let spake = self.spake.take().ok_or(PakeError::SpakeFailed)?;
        let shared_key = spake.finish(msg_client).map_err(|_| PakeError::SpakeFailed)?;
        let conf = derive_confirmation(&shared_key, &self.host_fp, &self.msg_host, msg_client);
        Ok(ServerFinished {
            send_host_mac: conf.host_mac,
            expect_client_mac: conf.client_mac,
            shared_key,
        })
    }
}

/// Client (side B) one-shot PAKE. The client receives the host message, sends
/// its own, then exchanges/verifies MACs. Implemented as a free function (no
/// long-lived state needed) plus a verify helper.
pub struct ClientFinished {
    /// SPAKE2 message to SEND to the host.
    pub send_msg_client: Vec<u8>,
    /// MAC to SEND to the host (proves the client knows the PIN).
    pub send_client_mac: [u8; MAC_LEN],
    /// The host's MAC must equal this (verify in constant time).
    pub expect_host_mac: [u8; MAC_LEN],
    /// The SPAKE2 shared key.
    pub shared_key: Vec<u8>,
}

/// Run the client side of the PAKE given the host's SPAKE2 message.
pub fn client_run(
    pin: &str,
    host_fp: &[u8; 32],
    msg_host: &[u8],
) -> Result<ClientFinished, PakeError> {
    client_run_with_rng(pin, host_fp, msg_host, rand_core::OsRng)
}

/// Deterministic variant for interop vectors.
pub fn client_run_with_rng(
    pin: &str,
    host_fp: &[u8; 32],
    msg_host: &[u8],
    rng: impl rand_core::CryptoRng + rand_core::RngCore,
) -> Result<ClientFinished, PakeError> {
    if msg_host.is_empty() {
        return Err(PakeError::BadMessage);
    }
    let (spake, msg_client) = Spake2::<Ed25519Group>::start_b_with_rng(
        &pin_password(pin),
        &Identity::new(ID_HOST),
        &Identity::new(ID_CLIENT),
        rng,
    );
    let shared_key = spake.finish(msg_host).map_err(|_| PakeError::SpakeFailed)?;
    let conf = derive_confirmation(&shared_key, host_fp, msg_host, &msg_client);
    Ok(ClientFinished {
        send_msg_client: msg_client,
        send_client_mac: conf.client_mac,
        expect_host_mac: conf.host_mac,
        shared_key,
    })
}

pub mod ffi;
pub mod vectors;

#[cfg(test)]
mod tests;
