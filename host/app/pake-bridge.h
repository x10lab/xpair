// pake-bridge.h — C ABI bridging header for the Rust SPAKE2 staticlib (libpake.a).
//
// Mirrors host/rd/pake/src/ffi.rs (the host / server / side-A half of PROTOCOL.md).
// Swift (PairingServer.swift) owns sockets + lifecycle; ALL crypto lives in the
// Rust crate. This header is the only Swift⇄Rust seam.
//
// authn-before-touch (Critical, Component ③/B2): the caller MUST receive OK from
// pake_verify_mac on the CLIENT's MAC before it reads the client pubkey or opens,
// stats, or writes ~/.ssh/*. This library performs no I/O of its own.
//
// Memory: the caller allocates every out buffer; the library never returns owned
// pointers to free. The opaque handle from pake_server_start is freed by EITHER a
// successful pake_server_step OR an explicit pake_server_free.

#ifndef REMOTEPAIR_PAKE_BRIDGE_H
#define REMOTEPAIR_PAKE_BRIDGE_H

#include <stdint.h>
#include <stddef.h>

// Max SPAKE2 message length (Ed25519: 1 type byte + 32-byte element).
#define PAKE_MSG_MAX 33
// Confirmation MAC length (HMAC-SHA256).
#define PAKE_MAC_LEN 32
// SPAKE2 shared-key serialization width.
#define PAKE_KEY_MAX 33

// codes::* (host/rd/pake/src/lib.rs). 0 == OK; non-OK leaves out buffers unspecified.
#define PAKE_OK            0
#define PAKE_BAD_MESSAGE   2
#define PAKE_SPAKE_FAILED  3
#define PAKE_MAC_MISMATCH  4
#define PAKE_BAD_ARGS      5
#define PAKE_IO_ERROR      6

// Opaque host PAKE session handle.
typedef struct PakeServerHandle PakeServerHandle;

// 1. Begin the host side. host_fp_ptr -> exactly 32 RAW SHA256 bytes of the
//    ssh-ed25519 host key (NOT the "SHA256:base64" string).
int32_t pake_server_start(const uint8_t *pin_ptr,
                          size_t pin_len,
                          const uint8_t *host_fp_ptr,
                          PakeServerHandle **out_handle,
                          uint8_t *out_msg,
                          size_t out_msg_cap,
                          size_t *out_msg_len);

// 2. Finish the host side. On OK the handle is CONSUMED and freed.
//    On a non-OK return the handle is left valid for pake_server_free.
int32_t pake_server_step(PakeServerHandle *handle,
                         const uint8_t *msg_client_ptr,
                         size_t msg_client_len,
                         uint8_t *out_send_mac,
                         uint8_t *out_expect_mac,
                         uint8_t *out_key,
                         size_t out_key_cap,
                         size_t *out_key_len);

// 3. Constant-time MAC compare. OK on match, MAC_MISMATCH otherwise.
//    This is the authn-before-touch gate.
int32_t pake_verify_mac(const uint8_t *expected_ptr,
                        size_t expected_len,
                        const uint8_t *got_ptr,
                        size_t got_len);

// Free a handle NOT consumed by a successful pake_server_step. Safe with NULL.
void pake_server_free(PakeServerHandle *handle);

#endif // REMOTEPAIR_PAKE_BRIDGE_H
