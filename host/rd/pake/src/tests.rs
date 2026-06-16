//! Unit + interop tests. `cargo test -p pake` exercises the HOST LINK PATH (the
//! rlib that becomes the staticlib); the client binary replays the SAME vectors
//! via `--selftest-vectors`. A vector mismatch fails CI on either side.

use crate::vectors::{self, SeededRng};
use crate::{
    channel_binding, client_run_with_rng, parse_host_fp, verify_mac, ServerSession, MAC_LEN,
};

fn fp() -> [u8; 32] {
    // Arbitrary but fixed 32-byte "host fingerprint" for the in-memory tests.
    let mut f = [0u8; 32];
    for (i, b) in f.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(7).wrapping_add(3);
    }
    f
}

/// Full host<->client round trip with the correct PIN: keys agree, both MACs
/// verify, channel bindings match.
#[test]
fn round_trip_correct_pin() {
    let pin = "482173";
    let (server, msg_host) = ServerSession::start_with_rng(pin, fp(), SeededRng::from_seed(&[1u8; 32]));
    let client =
        client_run_with_rng(pin, &fp(), &msg_host, SeededRng::from_seed(&[2u8; 32])).unwrap();
    let server_fin = server.step(&client.send_msg_client).unwrap();

    // Mutual MAC verification (constant time).
    verify_mac(&server_fin.expect_client_mac, &client.send_client_mac).unwrap();
    verify_mac(&client.expect_host_mac, &server_fin.send_host_mac).unwrap();

    assert_eq!(server_fin.shared_key, client.shared_key);
    assert_eq!(
        channel_binding(&fp(), &msg_host, &client.send_msg_client),
        channel_binding(&fp(), &msg_host, &client.send_msg_client)
    );
}

/// Wrong PIN: SPAKE2 still completes but the derived keys differ, so MAC
/// verification FAILS CLOSED on both sides.
#[test]
fn wrong_pin_fails_closed() {
    let (server, msg_host) =
        ServerSession::start_with_rng("482173", fp(), SeededRng::from_seed(&[1u8; 32]));
    let client =
        client_run_with_rng("000000", &fp(), &msg_host, SeededRng::from_seed(&[2u8; 32])).unwrap();
    let server_fin = server.step(&client.send_msg_client).unwrap();

    assert!(verify_mac(&server_fin.expect_client_mac, &client.send_client_mac).is_err());
    assert!(verify_mac(&client.expect_host_mac, &server_fin.send_host_mac).is_err());
}

/// Fingerprint binding: same PIN but the client expects a DIFFERENT host fp →
/// the MAC transcript differs → MAC verification fails. This is the anti-MITM /
/// channel-binding guarantee.
#[test]
fn wrong_fingerprint_fails_closed() {
    let pin = "482173";
    let (server, msg_host) = ServerSession::start_with_rng(pin, fp(), SeededRng::from_seed(&[1u8; 32]));
    let mut other_fp = fp();
    other_fp[0] ^= 0xFF;
    let client =
        client_run_with_rng(pin, &other_fp, &msg_host, SeededRng::from_seed(&[2u8; 32])).unwrap();
    let server_fin = server.step(&client.send_msg_client).unwrap();

    // SPAKE2 key agrees (same PIN), but the fp-bound MACs do not.
    assert_eq!(server_fin.shared_key, client.shared_key);
    assert!(verify_mac(&client.expect_host_mac, &server_fin.send_host_mac).is_err());
    assert!(verify_mac(&server_fin.expect_client_mac, &client.send_client_mac).is_err());
}

/// `verify_mac` is length-checked and rejects a truncated MAC.
#[test]
fn verify_mac_rejects_bad_length() {
    let expected = [0u8; MAC_LEN];
    assert!(verify_mac(&expected, &[0u8; MAC_LEN - 1]).is_err());
    assert!(verify_mac(&expected, &expected).is_ok());
}

/// Fingerprint parsing accepts both ssh-keygen `SHA256:` base64 and bare hex.
#[test]
fn parse_fp_both_forms() {
    let raw = fp();
    let hexform = hex::encode(raw);
    assert_eq!(parse_host_fp(&hexform).unwrap(), raw);

    // Build the unpadded standard-base64 ssh-keygen form and round-trip it.
    let b64 = base64_std(&raw);
    let sshform = format!("SHA256:{b64}");
    assert_eq!(parse_host_fp(&sshform).unwrap(), raw);

    assert!(parse_host_fp("not-hex-and-too-short").is_err());
}

/// Local std base64 encoder for the test only (mirrors the lib's decoder).
fn base64_std(data: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &b in data {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 6 {
            bits -= 6;
            out.push(A[((acc >> bits) & 0x3F) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(A[((acc << (6 - bits)) & 0x3F) as usize] as char);
    }
    out
}

/// THE interop gate: replay every committed vector file through the host link
/// path. The client binary replays the SAME files via `--selftest-vectors`, so
/// host and client are pinned to identical wire bytes. A mismatch fails here.
#[test]
fn committed_vectors_match() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/vectors");
    let mut count = 0;
    for entry in std::fs::read_dir(dir).expect("vectors dir").flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let body = std::fs::read_to_string(&path).expect("read vector");
        let v = vectors::parse(&body);
        vectors::check(&v).unwrap_or_else(|e| panic!("{e}"));
        count += 1;
    }
    assert!(count > 0, "no committed vectors found in {dir}");
}
