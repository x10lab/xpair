//! `remote-pair-pake` — client side of the RemotePair PIN PAKE (PROTOCOL.md).
//!
//! The bash CLI `remote-pair pair` verb (Component C2, `cmd_pair`) shells to this
//! binary. It owns the FULL handshake against the Swift host `PairingServer`
//! (Component B2) over a LAN TCP socket: SPAKE2 bound to the host-key
//! fingerprint, mutual confirmation MACs, and — only after MAC verify — the SSH
//! pubkey handoff. It FAILS CLOSED: a wrong PIN, an expired PIN, an fp mismatch,
//! or any tampering all exit non-zero and are indistinguishable.
//!
//! ## argv CONTRACT (matches the already-written `cmd_pair` caller — STABLE)
//!
//!   remote-pair-pake --host <ADDR> --pin <PIN> --expect-fp <FP> --pubkey <LINE>
//!
//!   --host <ADDR>         host LAN address (the fixed pairing port 53427 is
//!                         appended automatically; ADDR may also be ADDR:PORT).
//!   --pin  <PIN>          the 6-digit code shown on the host screen.
//!   --expect-fp <FP>      expected host-key fp: "SHA256:<base64>" (the form
//!                         `rp_norm_fp` emits) OR 64-char lowercase hex.
//!                         (alias: --fp)
//!   --pubkey <LINE>       the client's `~/.ssh/id_ed25519.pub` line; sent to the
//!                         host ONLY after the host MAC verifies.
//!
//!   exit 0  : PAKE confirmed AND the host authorized the pubkey ({"ok":true}).
//!   exit !=0: failure. stderr = generic "pairing failed" (never reveals which).
//!   exit codes (= pake::codes): 0 OK, 2 bad-message, 3 spake-failed,
//!     4 mac-mismatch (wrong/expired/tampered/fp-mismatch — indistinguishable),
//!     5 bad-args, 6 io-error.
//!
//! ## wire protocol (PROTOCOL.md §Framing; matches PairingServer.swift)
//! Bare length-prefixed frames: 2-byte big-endian length || payload. Sequence:
//!   1. host  -> client : msg_host    (SPAKE2 side-A message)
//!   2. client -> host  : msg_client  (SPAKE2 side-B message)
//!   3. host  -> client : host_mac    (32-byte confirmation MAC)
//!   4. client -> host  : client_mac  (32-byte confirmation MAC)   [post host-MAC verify]
//!   5. client -> host  : pubkey line                              [post MAC, authn-before-touch]
//!   6. host  -> client : result JSON {"ok":bool,"msg":string}
//!
//! ## hidden interop self-test (CI)
//!   remote-pair-pake --selftest-vectors <DIR>
//! Replays the committed vectors through the SAME crate logic — exit 0 = all pass.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use pake::codes;

/// Fixed LAN pairing port the host `PairingServer` binds (PairingServer.swift).
const PAIRING_PORT: u16 = 53427;

/// Send one bare length-prefixed frame (2-byte BE length || payload).
fn send_frame(s: &mut TcpStream, payload: &[u8]) -> Result<(), i32> {
    if payload.len() > u16::MAX as usize {
        return Err(codes::BAD_MESSAGE);
    }
    let mut buf = Vec::with_capacity(2 + payload.len());
    buf.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    buf.extend_from_slice(payload);
    s.write_all(&buf).map_err(|_| codes::IO_ERROR)
}

/// Receive one bare length-prefixed frame.
fn recv_frame(s: &mut TcpStream) -> Result<Vec<u8>, i32> {
    let mut hdr = [0u8; 2];
    s.read_exact(&mut hdr).map_err(|_| codes::IO_ERROR)?;
    let n = ((hdr[0] as usize) << 8) | hdr[1] as usize;
    if n == 0 || n > 8192 {
        return Err(codes::BAD_MESSAGE);
    }
    let mut payload = vec![0u8; n];
    s.read_exact(&mut payload).map_err(|_| codes::IO_ERROR)?;
    Ok(payload)
}

/// Append the fixed pairing port if the caller passed a bare address.
fn with_port(host: &str) -> String {
    // IPv6 literals in brackets, or anything already containing a port, pass through.
    if host.starts_with('[') || (host.contains(':') && host.rsplit(':').next().map_or(false, |p| p.parse::<u16>().is_ok())) {
        host.to_string()
    } else {
        format!("{host}:{PAIRING_PORT}")
    }
}

fn run_network(host: &str, pin: &str, fp_str: &str, pubkey: &str) -> i32 {
    let host_fp = match pake::parse_host_fp(fp_str) {
        Ok(fp) => fp,
        Err(_) => return codes::BAD_ARGS,
    };

    let addr = with_port(host);
    let mut stream = match TcpStream::connect(&addr) {
        Ok(s) => s,
        Err(_) => return codes::IO_ERROR,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));

    // 1. Receive the host's SPAKE2 message.
    let msg_host = match recv_frame(&mut stream) {
        Ok(m) => m,
        Err(c) => return c,
    };

    // 2. Run the client PAKE (binds host_fp into the MAC transcript) and send our
    //    SPAKE2 message.
    let fin = match pake::client_run(pin, &host_fp, &msg_host) {
        Ok(f) => f,
        Err(e) => return e.code(),
    };
    if let Err(c) = send_frame(&mut stream, &fin.send_msg_client) {
        return c;
    }

    // 3. Receive the host's MAC and verify it in constant time. FAIL CLOSED:
    //    wrong PIN / expired PIN / fp mismatch / tampering are indistinguishable.
    let host_mac = match recv_frame(&mut stream) {
        Ok(m) => m,
        Err(c) => return c,
    };
    if pake::verify_mac(&fin.expect_host_mac, &host_mac).is_err() {
        return codes::MAC_MISMATCH;
    }

    // 4. Host proved knowledge of the PIN AND the fp binding. Send our MAC.
    if let Err(c) = send_frame(&mut stream, &fin.send_client_mac) {
        return c;
    }

    // 5. authn-before-touch on the host side gates here: only after the host
    //    verifies OUR mac does it read this pubkey / touch ~/.ssh. Send it.
    if let Err(c) = send_frame(&mut stream, pubkey.trim().as_bytes()) {
        return c;
    }

    // 6. Read the host's result frame ({"ok":bool,"msg":...}). Exit 0 iff ok.
    let result = match recv_frame(&mut stream) {
        Ok(r) => r,
        Err(c) => return c,
    };
    let body = String::from_utf8_lossy(&result);
    if result_ok(&body) {
        // Surface any host message (e.g. "Enable Remote Login…") on stderr for
        // the CLI to relay; the PIN never appears here.
        if let Some(msg) = result_msg(&body) {
            if !msg.is_empty() {
                eprintln!("{msg}");
            }
        }
        codes::OK
    } else {
        codes::MAC_MISMATCH
    }
}

/// Minimal `{"ok":true}` check (avoids a JSON dep in the license firewall).
fn result_ok(body: &str) -> bool {
    let b: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    b.contains("\"ok\":true")
}

/// Extract the `"msg":"..."` field (best-effort, for relaying host guidance).
fn result_msg(body: &str) -> Option<String> {
    let key = "\"msg\":\"";
    let start = body.find(key)? + key.len();
    let rest = &body[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Hidden interop self-test mode.
    if let Some(pos) = args.iter().position(|a| a == "--selftest-vectors") {
        let dir = match args.get(pos + 1) {
            Some(d) => d.clone(),
            None => {
                eprintln!("--selftest-vectors requires a directory");
                std::process::exit(codes::BAD_ARGS);
            }
        };
        std::process::exit(pake::vectors::selftest_dir(&dir));
    }

    let usage =
        "usage: remote-pair-pake --host <ADDR> --pin <PIN> --expect-fp <FP> --pubkey <LINE>";
    let mut host = None;
    let mut pin = None;
    let mut fp = None;
    let mut pubkey = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--host" => {
                host = args.get(i + 1).cloned();
                i += 2;
            }
            "--pin" => {
                pin = args.get(i + 1).cloned();
                i += 2;
            }
            "--expect-fp" | "--fp" => {
                fp = args.get(i + 1).cloned();
                i += 2;
            }
            "--pubkey" => {
                pubkey = args.get(i + 1).cloned();
                i += 2;
            }
            "-h" | "--help" => {
                eprintln!("{usage}");
                std::process::exit(codes::OK);
            }
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(codes::BAD_ARGS);
            }
        }
    }

    let (host, pin, fp, pubkey) = match (host, pin, fp, pubkey) {
        (Some(h), Some(p), Some(f), Some(k)) => (h, p, f, k),
        _ => {
            eprintln!("{usage}");
            std::process::exit(codes::BAD_ARGS);
        }
    };

    let code = run_network(&host, &pin, &fp, &pubkey);
    if code != codes::OK {
        // Generic: never reveal wrong-vs-expired-vs-fp-mismatch-vs-tampered.
        eprintln!("pairing failed");
    }
    std::process::exit(code);
}
