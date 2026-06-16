//! End-to-end wire interop: a mock host (the SAME `ServerSession` crate logic +
//! the SAME bare 2-byte-BE framing PairingServer.swift uses) drives the real
//! `remote-pair-pake` client binary over a loopback TCP socket.
//!
//! This is the cross-artifact contract guard: if the binary's framing or message
//! order drifts from the host's, these tests fail. Correct PIN+fp → exit 0 and
//! the pubkey is delivered; wrong PIN / wrong fp → the binary exits non-zero and
//! NO pubkey is delivered (authn-before-touch holds on the wire).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;

use pake::ServerSession;

fn send_frame(s: &mut TcpStream, payload: &[u8]) {
    let n = payload.len() as u16;
    s.write_all(&n.to_be_bytes()).unwrap();
    s.write_all(payload).unwrap();
}

fn recv_frame(s: &mut TcpStream) -> Option<Vec<u8>> {
    let mut hdr = [0u8; 2];
    if s.read_exact(&mut hdr).is_err() {
        return None;
    }
    let n = ((hdr[0] as usize) << 8) | hdr[1] as usize;
    let mut payload = vec![0u8; n];
    if s.read_exact(&mut payload).is_err() {
        return None;
    }
    Some(payload)
}

const FP_HEX: &str = "8b1a9953c4611296a827abf8c47804d7e6c49c6b8f3e5c4f9d2a1b0e7c6d5a4b";
const PUBKEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY test@client";

fn fp_raw() -> [u8; 32] {
    let raw = hex::decode(FP_HEX).unwrap();
    let mut f = [0u8; 32];
    f.copy_from_slice(&raw);
    f
}

/// Run the mock host on `listener` against a single client connection.
/// `server_pin` is what the host believes the PIN is. Returns the pubkey the
/// host received (Some) — None means the handshake failed before pubkey (the
/// authn-before-touch wire guarantee).
fn mock_host(listener: TcpListener, server_pin: &str) -> Option<String> {
    let (mut conn, _) = listener.accept().ok()?;
    let (server, msg_host) = ServerSession::start(server_pin, fp_raw());
    send_frame(&mut conn, &msg_host); // 1
    let msg_client = recv_frame(&mut conn)?; // 2
    let fin = server.step(&msg_client).ok()?;
    send_frame(&mut conn, &fin.send_host_mac); // 3
    let client_mac = recv_frame(&mut conn)?; // 4
    // authn-before-touch GATE: verify the client MAC before reading the pubkey.
    if pake::verify_mac(&fin.expect_client_mac, &client_mac).is_err() {
        // Wrong/expired PIN or fp mismatch — do NOT read a pubkey.
        let _ = conn; // drop: indistinguishable failure (no result frame).
        return None;
    }
    let pubkey = recv_frame(&mut conn)?; // 5 (post-MAC only)
    send_frame(&mut conn, br#"{"ok":true,"msg":""}"#); // 6
    Some(String::from_utf8_lossy(&pubkey).to_string())
}

fn bin_path() -> String {
    // Cargo sets CARGO_BIN_EXE_<name> for integration tests.
    env!("CARGO_BIN_EXE_remote-pair-pake").to_string()
}

/// std base64 (unpadded standard alphabet) — mirror of the lib decoder, test-only.
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

#[test]
fn correct_pin_completes_and_delivers_pubkey() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let h = std::thread::spawn(move || mock_host(listener, "482173"));

    let fp = format!("SHA256:{}", base64_std(&fp_raw()));
    let status = Command::new(bin_path())
        .args(["--host", &addr, "--pin", "482173", "--expect-fp", &fp, "--pubkey", PUBKEY])
        .status()
        .unwrap();

    let received = h.join().unwrap();
    assert!(status.success(), "client should exit 0 on correct PIN");
    assert_eq!(received.as_deref(), Some(PUBKEY), "host got the pubkey");
}

#[test]
fn wrong_pin_fails_closed_no_pubkey() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    // Host believes a DIFFERENT PIN than the client will send.
    let h = std::thread::spawn(move || mock_host(listener, "999999"));

    let fp = format!("SHA256:{}", base64_std(&fp_raw()));
    let status = Command::new(bin_path())
        .args(["--host", &addr, "--pin", "482173", "--expect-fp", &fp, "--pubkey", PUBKEY])
        .status()
        .unwrap();

    let received = h.join().unwrap();
    assert!(!status.success(), "client must fail closed on wrong PIN");
    assert_eq!(received, None, "NO pubkey delivered (authn-before-touch)");
}

#[test]
fn wrong_fp_fails_closed_no_pubkey() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    // Host uses the real fp; client is told a DIFFERENT fp → MAC binding differs.
    let h = std::thread::spawn(move || mock_host(listener, "482173"));

    let mut wrong = fp_raw();
    wrong[0] ^= 0xFF;
    let fp = format!("SHA256:{}", base64_std(&wrong));
    let status = Command::new(bin_path())
        .args(["--host", &addr, "--pin", "482173", "--expect-fp", &fp, "--pubkey", PUBKEY])
        .status()
        .unwrap();

    let received = h.join().unwrap();
    assert!(!status.success(), "client must fail closed on fp mismatch");
    assert_eq!(received, None, "NO pubkey delivered on fp mismatch");
}
