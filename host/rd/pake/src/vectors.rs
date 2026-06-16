//! Interop test vectors — the single source of truth for host/client agreement.
//!
//! SPAKE2 messages are randomized, so a reproducible vector must PIN the RNG.
//! Each vector fixes the PIN, the host fingerprint, and two RNG seeds (one for
//! the host/side-A scalar, one for the client/side-B scalar), then records the
//! EXPECTED wire bytes and derived secrets. Both build artifacts replay the same
//! vectors:
//!   * `cargo test -p pake` (the host link path / rlib) — `tests.rs`;
//!   * `remote-pair-pake --selftest-vectors <dir>` (the client binary).
//! Any drift in framing, suite, transcript layout, or KDF makes a vector mismatch
//! and fails both.
//!
//! ## Vector file format (`vectors/*.txt`)
//! Plain `key = value` lines (one vector per file; `#` comments allowed). All
//! byte fields are lowercase hex. Hand-parsed to avoid pulling serde/json into
//! the permissive license firewall.
//!   name      = <label>
//!   pin       = <ascii pin, e.g. 482173>
//!   host_fp   = <64 hex chars : raw SHA256 of the ssh-ed25519 host key>
//!   seed_a    = <64 hex chars : host RNG seed>
//!   seed_b    = <64 hex chars : client RNG seed>
//!   msg_host  = <hex : expected SPAKE2 message from the host>
//!   msg_client= <hex : expected SPAKE2 message from the client>
//!   host_mac  = <hex : expected host confirmation MAC (32 bytes)>
//!   client_mac= <hex : expected client confirmation MAC (32 bytes)>
//!   shared_key= <hex : expected SPAKE2 shared key>
//!   channel   = <hex : expected channel binding = SHA256(transcript)>

use crate::{channel_binding, client_run_with_rng, derive_confirmation, ServerSession};
use rand_core::{CryptoRng, RngCore};

/// Deterministic, seedable RNG for vectors ONLY. A simple SplitMix64 stream — it
/// is NOT used on any production path (those use OS randomness). Implementing
/// `CryptoRng` here is a test-harness convenience to satisfy the spake2 API
/// bound; it makes no security claim.
pub struct SeededRng {
    state: u64,
}

impl SeededRng {
    /// Seed from the first 8 bytes of a 32-byte seed (the rest disambiguates the
    /// vector but the scalar only needs a reproducible stream).
    pub fn from_seed(seed: &[u8; 32]) -> Self {
        let mut s = [0u8; 8];
        s.copy_from_slice(&seed[..8]);
        SeededRng {
            state: u64::from_le_bytes(s) ^ 0x9E37_79B9_7F4A_7C15,
        }
    }
    fn next_u64_impl(&mut self) -> u64 {
        // SplitMix64.
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

impl RngCore for SeededRng {
    fn next_u32(&mut self) -> u32 {
        self.next_u64_impl() as u32
    }
    fn next_u64(&mut self) -> u64 {
        self.next_u64_impl()
    }
    fn fill_bytes(&mut self, dest: &mut [u8]) {
        let mut i = 0;
        while i < dest.len() {
            let bytes = self.next_u64_impl().to_le_bytes();
            let n = core::cmp::min(8, dest.len() - i);
            dest[i..i + n].copy_from_slice(&bytes[..n]);
            i += n;
        }
    }
    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core::Error> {
        self.fill_bytes(dest);
        Ok(())
    }
}

impl CryptoRng for SeededRng {}

/// A parsed interop vector (inputs + committed expected outputs).
#[derive(Debug, Clone)]
pub struct Vector {
    pub name: String,
    pub pin: String,
    pub host_fp: [u8; 32],
    pub seed_a: [u8; 32],
    pub seed_b: [u8; 32],
    pub msg_host: Vec<u8>,
    pub msg_client: Vec<u8>,
    pub host_mac: Vec<u8>,
    pub client_mac: Vec<u8>,
    pub shared_key: Vec<u8>,
    pub channel: Vec<u8>,
}

fn hex32(s: &str) -> [u8; 32] {
    let raw = hex::decode(s.trim()).expect("vector hex field");
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw);
    out
}

/// Parse a single-vector `key = value` file body.
pub fn parse(body: &str) -> Vector {
    let mut m: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            m.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    let g = |k: &str| -> String { m.get(k).unwrap_or_else(|| panic!("vector missing {k}")).clone() };
    let gh = |k: &str| -> Vec<u8> { hex::decode(g(k)).unwrap_or_else(|_| panic!("vector bad hex {k}")) };
    Vector {
        name: g("name"),
        pin: g("pin"),
        host_fp: hex32(&g("host_fp")),
        seed_a: hex32(&g("seed_a")),
        seed_b: hex32(&g("seed_b")),
        msg_host: gh("msg_host"),
        msg_client: gh("msg_client"),
        host_mac: gh("host_mac"),
        client_mac: gh("client_mac"),
        shared_key: gh("shared_key"),
        channel: gh("channel"),
    }
}

/// Outcome of re-deriving a vector from its pinned inputs.
pub struct Derived {
    pub msg_host: Vec<u8>,
    pub msg_client: Vec<u8>,
    pub host_mac: [u8; 32],
    pub client_mac: [u8; 32],
    pub shared_key: Vec<u8>,
    pub channel: [u8; 32],
}

/// Re-derive everything from the pinned inputs using the SAME crate logic the
/// production host/client paths use (host = ServerSession side A, client =
/// client_run side B), with the vector's seeded RNGs. The host and client MUST
/// agree internally (this is the host-link-path replay).
pub fn derive(v: &Vector) -> Derived {
    let (server, msg_host) =
        ServerSession::start_with_rng(&v.pin, v.host_fp, SeededRng::from_seed(&v.seed_a));
    let client = client_run_with_rng(&v.pin, &v.host_fp, &msg_host, SeededRng::from_seed(&v.seed_b))
        .expect("client_run");
    let server_fin = server.step(&client.send_msg_client).expect("server.step");

    // Internal agreement: both sides derive the same shared key + both MACs.
    assert_eq!(
        server_fin.shared_key, client.shared_key,
        "host/client shared key disagreement"
    );
    // Independent recompute of confirmation (defensive cross-check).
    let conf = derive_confirmation(
        &server_fin.shared_key,
        &v.host_fp,
        &msg_host,
        &client.send_msg_client,
    );
    assert_eq!(conf.host_mac, server_fin.send_host_mac);
    assert_eq!(conf.client_mac, server_fin.expect_client_mac);

    let channel = channel_binding(&v.host_fp, &msg_host, &client.send_msg_client);
    Derived {
        msg_host,
        msg_client: client.send_msg_client,
        host_mac: server_fin.send_host_mac,
        client_mac: server_fin.expect_client_mac,
        shared_key: server_fin.shared_key,
        channel,
    }
}

/// Compare a re-derivation against the committed expected bytes. Returns an error
/// string on the FIRST mismatch (so a wire-format drift fails loudly).
pub fn check(v: &Vector) -> Result<(), String> {
    let d = derive(v);
    let cmp = |field: &str, got: &[u8], want: &[u8]| -> Result<(), String> {
        if got == want {
            Ok(())
        } else {
            Err(format!(
                "vector '{}' field '{}' mismatch:\n  got  = {}\n  want = {}",
                v.name,
                field,
                hex::encode(got),
                hex::encode(want)
            ))
        }
    };
    cmp("msg_host", &d.msg_host, &v.msg_host)?;
    cmp("msg_client", &d.msg_client, &v.msg_client)?;
    cmp("host_mac", &d.host_mac, &v.host_mac)?;
    cmp("client_mac", &d.client_mac, &v.client_mac)?;
    cmp("shared_key", &d.shared_key, &v.shared_key)?;
    cmp("channel", &d.channel, &v.channel)?;
    Ok(())
}

/// Replay every `*.txt` vector in `dir`. Returns a process exit code:
/// `codes::OK` if all pass, `codes::MAC_MISMATCH` on any vector mismatch,
/// `codes::IO_ERROR` if the directory cannot be read or has no vectors. Used by
/// `remote-pair-pake --selftest-vectors` so the CLIENT BINARY consumes the SAME
/// committed vectors as the host test path.
pub fn selftest_dir(dir: &str) -> i32 {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("cannot read vectors dir {dir}: {e}");
            return crate::codes::IO_ERROR;
        }
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let body = match std::fs::read_to_string(&path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("cannot read {}: {e}", path.display());
                return crate::codes::IO_ERROR;
            }
        };
        let v = parse(&body);
        if let Err(msg) = check(&v) {
            eprintln!("{msg}");
            return crate::codes::MAC_MISMATCH;
        }
        count += 1;
    }
    if count == 0 {
        eprintln!("no *.txt vectors found in {dir}");
        return crate::codes::IO_ERROR;
    }
    eprintln!("ok: {count} interop vector(s) verified");
    crate::codes::OK
}
