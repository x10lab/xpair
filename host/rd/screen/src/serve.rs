//! `serve` — the v1a continuous-capture WebSocket JPEG frame server.
//!
//! This is the first real streaming path for Xpair Remote Desktop. It
//! replaces the v0 ssh-screenshot polling with a persistent capture loop that
//! pushes JPEG frames over a WebSocket.
//!
//! ## Architecture (synchronous, no async runtime)
//!
//! ```text
//!   main thread:  capture loop  ──(Arc<Vec<u8>> frame)──▶  per-client mpsc
//!                 (paced @ fps)                            channels (broadcast)
//!
//!   accept thread:  TcpListener.accept() ──▶ tungstenite::accept (WS handshake)
//!                                          ──▶ spawn per-client send thread
//!
//!   per-client thread:  recv(frame) ──▶ websocket.send(Binary(jpeg))
//! ```
//!
//! - **Loopback only.** Binds `127.0.0.1:<port>`. No TLS — the client reaches
//!   the server over an `ssh -L` tunnel, which provides transport encryption.
//! - **Skip when idle.** If no client is connected the capture loop does not
//!   capture or encode at all (saves CPU + avoids needless Screen Recording use).
//! - **Clean connect/disconnect.** Each client owns a thread and an mpsc
//!   receiver. When a client disconnects (send error, or the bounded channel
//!   backs up because the client is too slow), its sender is dropped and the
//!   capture loop prunes it from the broadcast set on the next frame.
//!
//! ## Performance: change detection (frame-skip)
//!
//! The capture loop compares each freshly captured frame's **raw pixels** against
//! the previous frame (a `memcmp`, far cheaper than JPEG encoding). When nothing
//! on screen changed it **skips JPEG encode AND broadcast entirely** — so a
//! static screen (the common case for a code editor / paused pair session) costs
//! ~0 network bytes and ~0 encode CPU, instead of re-sending an identical
//! full-frame JPEG every tick. This is the single biggest efficiency win
//! available without a true inter-frame codec.
//!
//! To keep late-joining viewers correct on a static screen, the most recent
//! encoded frame is cached in a shared slot and pushed once at connect time —
//! otherwise a client connecting after the screen went idle would see nothing
//! until the next change.
//!
//! ## NOT in v1a
//!
//! No VideoToolbox HW encode, no true inter-frame (P-frame) codec, no webrtc.
//! Those are v1b. This is the software JPEG path with whole-frame change
//! detection: correct, license-clean, and good enough for a remote desktop over
//! a loopback ssh tunnel.

use std::io::Cursor;
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use image::codecs::jpeg::JpegEncoder;
use tungstenite::protocol::Message;

/// The most recently encoded JPEG frame, shared so a newly connected client can
/// be sent the current screen immediately (important when the screen is static
/// and the capture loop is therefore not broadcasting). `None` until the first
/// frame has been captured and encoded.
type Latest = Arc<Mutex<Option<Arc<Vec<u8>>>>>;

/// A connected client: the sending half of its frame channel, plus a short
/// label for logging. The capture loop broadcasts to every live `tx`.
struct Client {
    id: u64,
    tx: SyncSender<Arc<Vec<u8>>>,
}

/// Shared registry of connected clients. Guarded by a `Mutex`; contention is
/// trivial (touched once per accepted connection and once per captured frame).
type Clients = Arc<Mutex<Vec<Client>>>;

/// Entry point for the `serve` subcommand.
///
/// Returns `Err` only for fatal startup problems (e.g. the port is taken or no
/// display is available). Once the accept loop is running this blocks forever in
/// the capture loop, so a normal return does not happen in practice.
pub fn run(port: u16, fps: u32, quality: u8, scale: f32) -> Result<(), String> {
    let fps = fps.clamp(1, 120);
    let quality = quality.clamp(1, 100);
    let scale = scale.clamp(0.1, 1.0);
    let frame_interval = Duration::from_secs_f64(1.0 / fps as f64);

    // Fail fast if we cannot even see a display — better a clear startup error
    // than a server that accepts clients and only ever sends nothing.
    let monitor = crate::primary_monitor()?;

    let addr = format!("127.0.0.1:{port}");
    let listener = TcpListener::bind(&addr)
        .map_err(|e| format!("could not bind {addr} (loopback): {e}"))?;

    tracing::info!(
        "screen serve: listening on ws://{addr} \
         (fps={fps}, jpeg quality={quality}, scale={scale}, loopback only)"
    );
    tracing::info!("  reach it from a client over:  ssh -L {port}:127.0.0.1:{port} <host>");
    tracing::info!("  the IDE webview then connects ws://127.0.0.1:{port}");

    let clients: Clients = Arc::new(Mutex::new(Vec::new()));
    let latest: Latest = Arc::new(Mutex::new(None));

    // Accept loop on its own thread so the main thread can run the capture loop.
    {
        let clients = Arc::clone(&clients);
        let latest = Arc::clone(&latest);
        thread::Builder::new()
            .name("ws-accept".into())
            .spawn(move || accept_loop(listener, clients, latest))
            .map_err(|e| format!("could not spawn accept thread: {e}"))?;
    }

    capture_loop(monitor, clients, latest, frame_interval, quality, scale);
    Ok(())
}

/// Accept WebSocket connections forever, registering each as a client.
fn accept_loop(listener: TcpListener, clients: Clients, latest: Latest) {
    let mut next_id: u64 = 1;
    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("serve: accept error: {e}");
                continue;
            }
        };
        let id = next_id;
        next_id += 1;
        let clients = Arc::clone(&clients);
        let latest = Arc::clone(&latest);
        let _ = thread::Builder::new()
            .name(format!("ws-client-{id}"))
            .spawn(move || client_thread(id, stream, clients, latest));
    }
}

/// Perform the WS handshake for one client, then pump frames to it until it
/// disconnects. Owns the receiving half of the broadcast channel.
fn client_thread(id: u64, stream: TcpStream, clients: Clients, latest: Latest) {
    let peer = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "<unknown>".into());

    // Disable Nagle: we send whole JPEG frames and want them out immediately.
    let _ = stream.set_nodelay(true);

    let mut websocket = match tungstenite::accept(stream) {
        Ok(ws) => ws,
        Err(e) => {
            tracing::warn!("serve: client {id} ({peer}) handshake failed: {e}");
            return;
        }
    };

    // Bounded channel: at most a few frames may queue for a slow client before
    // we drop frames (and ultimately the client). This bounds memory and keeps
    // a slow client from making the capture loop block.
    let (tx, rx) = sync_channel::<Arc<Vec<u8>>>(2);

    clients.lock().unwrap().push(Client { id, tx });
    tracing::info!("serve: client {id} ({peer}) connected");

    // Push the current screen immediately. On a static screen the capture loop
    // is not broadcasting (nothing changed), so without this a late joiner would
    // stare at a blank viewer until the next on-screen change.
    if let Some(frame) = latest.lock().unwrap().clone() {
        if websocket
            .send(Message::Binary(frame.as_ref().clone()))
            .is_err()
        {
            remove_client(&clients, id);
            return;
        }
    }

    // Forward frames until the channel closes (capture loop dropped our tx,
    // meaning it pruned us) or a send fails (client went away).
    loop {
        let frame = match rx.recv() {
            Ok(f) => f,
            Err(_) => break, // tx dropped by capture loop -> we were pruned
        };
        if websocket
            .send(Message::Binary(frame.as_ref().clone()))
            .is_err()
        {
            break;
        }
        // Best-effort: drain any control frames (e.g. client Close/Ping) without
        // blocking the send cadence. tungstenite handles Ping->Pong on send/read.
    }

    remove_client(&clients, id);
    let _ = websocket.close(None);
    tracing::info!("serve: client {id} ({peer}) disconnected");
}

/// Remove a client from the registry by id (idempotent).
fn remove_client(clients: &Clients, id: u64) {
    let mut guard = clients.lock().unwrap();
    guard.retain(|c| c.id != id);
}

/// The capture loop: at the target cadence, capture one frame, and — only if it
/// differs from the previous frame — JPEG-encode it and broadcast it to every
/// connected client. Skips all work when nobody is connected. Runs on the main
/// thread (blocks forever).
///
/// Change detection compares the raw RGBA pixels (a `memcmp`) before spending
/// any cycles on JPEG encoding. A static screen therefore costs only the capture
/// + compare, never an encode or a network send.
fn capture_loop(
    monitor: xcap::Monitor,
    clients: Clients,
    latest: Latest,
    frame_interval: Duration,
    quality: u8,
    scale: f32,
) {
    let mut warned_capture = false;
    // Cheap mid-run rotation guard (contract §7 "long-lived guard"): this loop
    // is the only long-lived process in the crate, so it must size-check the log
    // periodically rather than relying on rotate-on-open alone.
    let mut tick: u64 = 0;
    const ROTATE_CHECK_EVERY: u64 = 300;
    // Previous frame's raw pixels, for change detection. Empty = "no frame yet".
    let mut prev_raw: Vec<u8> = Vec::new();
    // Whether the previous cycle had clients. Used to force a fresh frame when a
    // viewer (re)connects after an idle gap, so `prev_raw` from before the idle
    // period can never suppress the first frame the new viewer needs.
    let mut had_clients = false;
    // RD keep-awake: while >=1 client is connected, hold a `caffeinate -d` child so the
    // remote display never sleeps / shows the screensaver / idle-locks — RD always
    // mirrors a live screen. Released the instant the last client disconnects, so the
    // Mac sleeps normally when nobody is viewing.
    let mut caffeinate: Option<std::process::Child> = None;

    loop {
        let cycle_start = Instant::now();

        // Long-lived rotation guard: stat the log every N cycles (cheap) and
        // rotate mid-run if it has outgrown the cap.
        tick = tick.wrapping_add(1);
        if tick.is_multiple_of(ROTATE_CHECK_EVERY) {
            crate::log::rotate_guard();
        }

        // Snapshot the live senders. If nobody is connected, skip capture
        // entirely — no point exercising Screen Recording for zero viewers.
        let have_clients = !clients.lock().unwrap().is_empty();
        if !have_clients {
            had_clients = false;
            // Last viewer gone: drop keep-awake so the Mac can sleep normally.
            if let Some(mut c) = caffeinate.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            thread::sleep(frame_interval);
            continue;
        }
        // Idle -> active transition: force the next captured frame to be sent
        // even if it happens to match the stale `prev_raw`.
        if !had_clients {
            prev_raw.clear();
        }
        had_clients = true;
        // First viewer present: hold display-sleep off for the duration of viewing.
        if caffeinate.is_none() {
            caffeinate = std::process::Command::new("caffeinate")
                .arg("-d")
                .spawn()
                .ok();
        }

        match monitor.capture_image() {
            Ok(frame) => {
                warned_capture = false;
                let raw = frame.as_raw();
                // Unchanged since last sent frame? Skip encode + broadcast.
                if !prev_raw.is_empty() && prev_raw.as_slice() == raw.as_slice() {
                    let elapsed = cycle_start.elapsed();
                    if let Some(remaining) = frame_interval.checked_sub(elapsed) {
                        thread::sleep(remaining);
                    }
                    continue;
                }

                // Changed (or first frame): remember it (raw, full-res — change
                // detection always compares native pixels), then optionally
                // downscale before encoding. Resize happens ONLY here, on a
                // changed frame, so a static screen pays nothing for it.
                prev_raw.clear();
                prev_raw.extend_from_slice(raw);

                let encoded = if scale < 1.0 {
                    let nw = ((frame.width() as f32 * scale) as u32).max(1);
                    let nh = ((frame.height() as f32 * scale) as u32).max(1);
                    let small = xcap::image::imageops::resize(
                        &frame,
                        nw,
                        nh,
                        xcap::image::imageops::FilterType::Triangle,
                    );
                    encode_jpeg(&small, quality)
                } else {
                    encode_jpeg(&frame, quality)
                };

                match encoded {
                    Ok(jpeg) => {
                        let frame = Arc::new(jpeg);
                        *latest.lock().unwrap() = Some(Arc::clone(&frame));
                        broadcast(&clients, frame);
                    }
                    Err(e) => {
                        if !warned_capture {
                            tracing::error!("serve: jpeg encode failed: {e}");
                            warned_capture = true;
                        }
                    }
                }
            }
            Err(e) => {
                if !warned_capture {
                    tracing::error!(
                        "serve: capture failed (check Screen Recording \
                         permission for THIS binary): {e}"
                    );
                    warned_capture = true;
                }
            }
        }

        // Pace to the target fps, accounting for the time capture+encode took.
        let elapsed = cycle_start.elapsed();
        if let Some(remaining) = frame_interval.checked_sub(elapsed) {
            thread::sleep(remaining);
        }
    }
}

/// Send one encoded frame to every connected client. Drops the frame for any
/// client whose bounded channel is full (slow client) and prunes any client
/// whose channel is closed (its thread exited).
fn broadcast(clients: &Clients, frame: Arc<Vec<u8>>) {
    let mut guard = clients.lock().unwrap();
    guard.retain(|c| match c.tx.try_send(Arc::clone(&frame)) {
        Ok(()) => true,
        // Slow client: keep it, just skip this frame for it.
        Err(TrySendError::Full(_)) => true,
        // Receiver gone: prune it.
        Err(TrySendError::Disconnected(_)) => false,
    });
}

/// JPEG-encode an already-captured frame at the given quality.
fn encode_jpeg(frame: &xcap::image::RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    {
        let mut encoder = JpegEncoder::new_with_quality(Cursor::new(&mut buf), quality);
        encoder
            .encode_image(frame)
            .map_err(|e| format!("jpeg encode: {e}"))?;
    }
    Ok(buf)
}
