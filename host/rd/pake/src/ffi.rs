//! C ABI for the Swift host `PairingServer.swift` to link the staticlib.
//!
//! Swift owns sockets and lifecycle; ALL group math / crypto lives here. The
//! ABI is the host (server / side A) half of the PROTOCOL.md flow:
//!
//!   1. `pake_server_start(pin, host_fp, ...)`   -> opaque handle + msg_host
//!   2. (Swift sends msg_host, receives msg_client over the LAN socket)
//!   3. `pake_server_step(handle, msg_client, ...)` -> send_host_mac + the
//!      expected client MAC + the shared key (handle is consumed/freed)
//!   4. `pake_verify_mac(expect, got)`           -> constant-time check
//!
//! authn-before-touch (Critical invariant, Component B2): Swift MUST call
//! `pake_verify_mac` on the client's MAC and get `OK` BEFORE it reads the
//! client pubkey or touches `~/.ssh/*`. This library performs no I/O of its own.
//!
//! Memory rules:
//!   * Every `*_start`/`*_step` writes into caller-provided fixed buffers; the
//!     caller allocates, the library never returns owned pointers to free.
//!   * The opaque handle from `pake_server_start` is freed by EITHER a
//!     successful `pake_server_step` OR an explicit `pake_server_free`.
//!
//! Return values are the `codes::*` integers (0 = OK). On a non-OK return,
//! output buffers are left unspecified and must be ignored.

use crate::{codes, ServerSession, MAC_LEN};
use core::ptr;
use core::slice;

/// Maximum SPAKE2 message length (Ed25519: 1 type byte + 32-byte element).
/// Exposed so Swift can size its buffers without guessing.
pub const PAKE_MSG_MAX: usize = 33;
/// Confirmation MAC length (HMAC-SHA256).
pub const PAKE_MAC_LEN: usize = MAC_LEN;
/// SPAKE2 shared-key length (Ed25519 group element serialization width).
pub const PAKE_KEY_MAX: usize = 33;

/// Opaque host PAKE session handle. Created by `pake_server_start`, consumed by
/// `pake_server_step`, or freed by `pake_server_free`.
pub struct PakeServerHandle {
    inner: Option<ServerSession>,
}

/// Begin the host side of the PAKE.
///
/// # Parameters
/// * `pin_ptr`/`pin_len`        — the displayed PIN (ASCII digits), NOT NUL-required.
/// * `host_fp_ptr`              — pointer to exactly 32 raw SHA256 bytes of the
///                               ssh-ed25519 host key.
/// * `out_handle`               — receives the opaque session pointer on OK.
/// * `out_msg`/`out_msg_cap`    — caller buffer (>= PAKE_MSG_MAX) for msg_host.
/// * `out_msg_len`             — receives the bytes written to `out_msg`.
///
/// # Safety
/// All pointers must be valid for the stated lengths; `host_fp_ptr` must point to
/// >= 32 readable bytes. On a non-OK return `*out_handle` is set to null.
#[no_mangle]
pub unsafe extern "C" fn pake_server_start(
    pin_ptr: *const u8,
    pin_len: usize,
    host_fp_ptr: *const u8,
    out_handle: *mut *mut PakeServerHandle,
    out_msg: *mut u8,
    out_msg_cap: usize,
    out_msg_len: *mut usize,
) -> i32 {
    if pin_ptr.is_null()
        || host_fp_ptr.is_null()
        || out_handle.is_null()
        || out_msg.is_null()
        || out_msg_len.is_null()
    {
        return codes::BAD_ARGS;
    }
    *out_handle = ptr::null_mut();

    let pin_bytes = slice::from_raw_parts(pin_ptr, pin_len);
    let pin = match core::str::from_utf8(pin_bytes) {
        Ok(s) => s,
        Err(_) => return codes::BAD_ARGS,
    };
    let mut host_fp = [0u8; 32];
    host_fp.copy_from_slice(slice::from_raw_parts(host_fp_ptr, 32));

    let (session, msg_host) = ServerSession::start(pin, host_fp);
    if msg_host.len() > out_msg_cap {
        return codes::BAD_ARGS;
    }
    ptr::copy_nonoverlapping(msg_host.as_ptr(), out_msg, msg_host.len());
    *out_msg_len = msg_host.len();

    let handle = Box::new(PakeServerHandle {
        inner: Some(session),
    });
    *out_handle = Box::into_raw(handle);
    codes::OK
}

/// Finish the host side: consume the client's SPAKE2 message, derive the MACs.
///
/// On OK the handle is CONSUMED and freed (do not reuse or free it again).
/// On a non-OK return the handle is left valid so the caller may `pake_server_free`.
///
/// * `out_send_mac`   — caller buffer (>= PAKE_MAC_LEN): the MAC to SEND to the client.
/// * `out_expect_mac` — caller buffer (>= PAKE_MAC_LEN): the MAC to EXPECT from the client.
/// * `out_key`/`out_key_cap`/`out_key_len` — the SPAKE2 shared key (may be ignored).
///
/// # Safety
/// `handle` must be a live pointer from `pake_server_start`; all out buffers must
/// be valid for their stated capacities.
#[no_mangle]
pub unsafe extern "C" fn pake_server_step(
    handle: *mut PakeServerHandle,
    msg_client_ptr: *const u8,
    msg_client_len: usize,
    out_send_mac: *mut u8,
    out_expect_mac: *mut u8,
    out_key: *mut u8,
    out_key_cap: usize,
    out_key_len: *mut usize,
) -> i32 {
    if handle.is_null()
        || msg_client_ptr.is_null()
        || out_send_mac.is_null()
        || out_expect_mac.is_null()
    {
        return codes::BAD_ARGS;
    }
    let h = &mut *handle;
    let session = match h.inner.take() {
        Some(s) => s,
        None => return codes::BAD_ARGS,
    };
    let msg_client = slice::from_raw_parts(msg_client_ptr, msg_client_len);

    match session.step(msg_client) {
        Ok(fin) => {
            ptr::copy_nonoverlapping(fin.send_host_mac.as_ptr(), out_send_mac, MAC_LEN);
            ptr::copy_nonoverlapping(fin.expect_client_mac.as_ptr(), out_expect_mac, MAC_LEN);
            if !out_key.is_null() && !out_key_len.is_null() {
                if fin.shared_key.len() > out_key_cap {
                    // The MACs are already written; signal the truncation only.
                    *out_key_len = 0;
                } else {
                    ptr::copy_nonoverlapping(
                        fin.shared_key.as_ptr(),
                        out_key,
                        fin.shared_key.len(),
                    );
                    *out_key_len = fin.shared_key.len();
                }
            }
            // Consume the handle on success.
            drop(Box::from_raw(handle));
            codes::OK
        }
        Err(e) => {
            // Restore nothing; the session is gone. Leave handle for free().
            // (inner is already None, so a re-step returns BAD_ARGS.)
            e.code()
        }
    }
}

/// Constant-time compare of an expected MAC against a received MAC.
///
/// Returns `codes::OK` on match, `codes::MAC_MISMATCH` otherwise. This is the
/// authn-before-touch gate: a wrong/expired PIN and a tampered MAC are
/// indistinguishable (both `MAC_MISMATCH`).
///
/// # Safety
/// Both pointers must be valid for their stated lengths.
#[no_mangle]
pub unsafe extern "C" fn pake_verify_mac(
    expected_ptr: *const u8,
    expected_len: usize,
    got_ptr: *const u8,
    got_len: usize,
) -> i32 {
    if expected_ptr.is_null() || got_ptr.is_null() || expected_len != MAC_LEN {
        return codes::MAC_MISMATCH;
    }
    let mut expected = [0u8; MAC_LEN];
    expected.copy_from_slice(slice::from_raw_parts(expected_ptr, MAC_LEN));
    let got = slice::from_raw_parts(got_ptr, got_len);
    match crate::verify_mac(&expected, got) {
        Ok(()) => codes::OK,
        Err(_) => codes::MAC_MISMATCH,
    }
}

/// Free a host PAKE handle that was NOT consumed by a successful
/// `pake_server_step` (e.g. after an error, or on disarm/timeout). Safe to call
/// with null.
///
/// # Safety
/// `handle` must be a live pointer from `pake_server_start` that has not already
/// been freed/consumed.
#[no_mangle]
pub unsafe extern "C" fn pake_server_free(handle: *mut PakeServerHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}
