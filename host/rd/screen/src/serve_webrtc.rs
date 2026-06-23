//! `serve-webrtc` — continuous-capture **WebRTC (UDP/RTP) H.264** screen server.
//!
//! The real v1b transport. UDP is mandatory: TCP/WebSocket head-of-line blocking
//! stalls a screen stream on any lost packet. Media flows over webrtc-rs
//! (DTLS/SRTP over UDP/ICE); only the tiny SDP/ICE **signaling** uses a WS side
//! channel (control data — HoL irrelevant there).
//!
//! ```text
//!   capture thread:  xcap RGBA ─swizzle→BGRA─▶ rp-vt-encode stdin (VTCompressionSession)
//!   reader thread:   rp-vt-encode stdout ─[4B len|Annex-B AU]→ tokio mpsc
//!   rtp task:        mpsc ─▶ TrackLocalStaticSample::write_sample (H264 → RTP/SRTP/UDP)
//!   signaling:       ws://127.0.0.1:<port>/  JSON {offer,answer,candidate}
//! ```
//! Client = browser/webview `RTCPeerConnection` (Chromium native WebRTC, decodes
//! H.264 on macOS/Windows/Linux → cross-platform) rendering into a `<video>`.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

/// Locate a helper binary that sits **next to this executable** (the bundle
/// `Contents/Helpers/` layout). `current_exe()` is `canonicalize()`d first so a
/// symlinked launch path (e.g. `~/.xpair/host/bin/screen` → bundle Helpers) is
/// resolved to the real bundle dir, where the sibling helpers actually live.
/// Returns `None` when no sibling helper exists (dev `cargo run`, missing file).
fn sibling_helper(name: &str) -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let real = exe.canonicalize().unwrap_or(exe);
    let sibling = real.parent()?.join(name);
    if sibling.exists() {
        return sibling.to_str().map(|s| s.to_string());
    }
    None
}

/// Resolve the SCK capture+encode helper (`rp-screencap`). It self-captures via
/// ScreenCaptureKit and encodes H.264 — no raw-frame pipe, no Rust-side capture.
/// Order: `$RP_SCREENCAP` → bundle sibling (`current_exe` dir) →
/// `~/.xpair/host/bin` → PATH.
fn screencap_path() -> String {
    if let Ok(p) = std::env::var("RP_SCREENCAP") {
        return p;
    }
    if let Some(p) = sibling_helper("rp-screencap") {
        return p;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let deployed = format!("{home}/.xpair/host/bin/rp-screencap");
    if std::path::Path::new(&deployed).exists() {
        return deployed;
    }
    "rp-screencap".to_string()
}

pub fn run(port: u16, fps: u32, bitrate: u32, scale: f32) -> Result<(), String> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio runtime: {e}"))?;
    rt.block_on(async move { run_async(port, fps, bitrate, scale).await })
}

async fn run_async(port: u16, fps: u32, bitrate: u32, scale: f32) -> Result<(), String> {
    let fps = fps.clamp(1, 120);
    let scale = scale.clamp(0.1, 1.0);

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;
    tracing::info!("screen serve-webrtc: signaling ws://{addr} (H.264/WebRTC UDP)");
    tracing::info!("  reach signaling over:  ssh -L {port}:127.0.0.1:{port} <host>");
    tracing::info!("  media flows P2P over UDP/ICE (host-candidate, loopback/LAN/VPN)");

    // One browser (pair session is 1:1). Each signaling connection gets a fresh
    // PeerConnection + encoder pipeline; teardown on disconnect.
    loop {
        crate::log::rotate_guard(); // §7 long-lived guard: also rotate between signaling sessions
        let (stream, peer) = match listener.accept().await {
            Ok(x) => x,
            Err(e) => {
                tracing::warn!("serve-webrtc: accept error: {e}");
                continue;
            }
        };
        tracing::info!("serve-webrtc: signaling client {peer} connected");
        if let Err(e) = handle_session(stream, fps, bitrate, scale).await {
            tracing::warn!("serve-webrtc: session ended: {e}");
        }
        tracing::info!("serve-webrtc: signaling client {peer} done");
    }
}

async fn handle_session(
    stream: tokio::net::TcpStream,
    fps: u32,
    bitrate: u32,
    scale: f32,
) -> Result<(), String> {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("ws handshake: {e}"))?;
    let (mut ws_tx, mut ws_rx) = ws.split();

    // --- build webrtc API with H264 ---
    let mut m = MediaEngine::default();
    m.register_default_codecs().map_err(|e| e.to_string())?;
    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut m).map_err(|e| e.to_string())?;
    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();
    let pc = Arc::new(
        api.new_peer_connection(RTCConfiguration::default())
            .await
            .map_err(|e| e.to_string())?,
    );

    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_H264.to_owned(),
            clock_rate: 90000,
            sdp_fmtp_line:
                "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f".to_owned(),
            ..Default::default()
        },
        "video".to_owned(),
        "xpair-screen".to_owned(),
    ));
    let rtp_sender = pc
        .add_track(track.clone() as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

    // RTCP reader: the client sends PictureLossIndication / FullIntraRequest when it
    // loses a keyframe (e.g. a packet of the 76KB IDR dropped on a lossy link). Forward
    // that as a {"keyframe":true} control line so the parent app forces a fresh IDR —
    // otherwise the remote viewer stays BLACK forever. read_rtcp() returning Err ends
    // the task (session over). In standalone mode (no RP_AU_STDIN) the parent ignores
    // the control line harmlessly; the loop still drains RTCP as webrtc-rs expects.
    {
        let rtp_sender = rtp_sender.clone();
        tokio::spawn(async move {
            use webrtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
            use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
            while let Ok((packets, _attrs)) = rtp_sender.read_rtcp().await {
                for pkt in packets {
                    let any = pkt.as_any();
                    if any.downcast_ref::<PictureLossIndication>().is_some()
                        || any.downcast_ref::<FullIntraRequest>().is_some()
                    {
                        tracing::info!("serve-webrtc: RTCP PLI/FIR -> requesting keyframe");
                        write_control("{\"keyframe\":true}\n");
                    }
                }
            }
            tracing::info!("serve-webrtc: RTCP reader ended (sender closed)");
        });
    }

    // --- ICE candidate trickle: PC -> browser (via an mpsc to the WS writer) ---
    let (sig_tx, mut sig_rx) = mpsc::unbounded_channel::<String>();
    {
        let sig_tx = sig_tx.clone();
        pc.on_ice_candidate(Box::new(move |cand| {
            let sig_tx = sig_tx.clone();
            Box::pin(async move {
                if let Some(c) = cand {
                    if let Ok(init) = c.to_json() {
                        let msg = serde_json::json!({
                            "type": "candidate",
                            "candidate": init.candidate,
                            "sdpMid": init.sdp_mid,
                            "sdpMLineIndex": init.sdp_mline_index,
                        });
                        let _ = sig_tx.send(msg.to_string());
                    }
                }
            })
        }));
    }
    // RD keep-awake: hold a `caffeinate -d` child while the peer is connected so the
    // remote display never sleeps / shows the screensaver / idle-locks — RD always
    // mirrors a live screen. Released on disconnect/teardown. Pair is 1:1, so a single
    // child tracks the one active viewer.
    let caffeinate: Arc<std::sync::Mutex<Option<std::process::Child>>> =
        Arc::new(std::sync::Mutex::new(None));
    let caffeinate_cb = Arc::clone(&caffeinate);
    pc.on_peer_connection_state_change(Box::new(move |s| {
        use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
        tracing::info!("serve-webrtc: peer connection state: {s}");
        if let Ok(mut guard) = caffeinate_cb.lock() {
            match s {
                RTCPeerConnectionState::Connected => {
                    if guard.is_none() {
                        *guard = Command::new("caffeinate").arg("-d").spawn().ok();
                    }
                }
                RTCPeerConnectionState::Disconnected
                | RTCPeerConnectionState::Failed
                | RTCPeerConnectionState::Closed => {
                    if let Some(mut c) = guard.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                }
                _ => {}
            }
        }
        Box::pin(async {})
    }));

    // --- encoder pipeline ---
    // RP_AU_STDIN=1: the parent app captures+encodes in-process (using the app's
    // Screen Recording TCC grant) and feeds already-encoded Annex-B AUs to our
    // stdin. We then ONLY do WebRTC transport — no rp-screencap spawn. stdout is
    // the control channel back to the app ({"capture":"start"|"stop"}\n).
    // Default (env unset): spawn rp-screencap exactly as before (standalone/dev).
    let (au_tx, mut au_rx) = mpsc::channel::<Vec<u8>>(16);
    let au_stdin_mode = std::env::var("RP_AU_STDIN").as_deref() == Ok("1");
    let cap_handle: CaptureSource = if au_stdin_mode {
        CaptureSource::Stdin(spawn_au_stdin_reader(au_tx))
    } else {
        CaptureSource::Child(spawn_screencap(fps, bitrate, scale, au_tx)?)
    };

    // rtp task: forward access units to the track as H264 samples
    let track_w = track.clone();
    let frame_dur = Duration::from_secs_f64(1.0 / fps as f64);
    tokio::spawn(async move {
        let mut frames: u64 = 0;
        while let Some(au) = au_rx.recv().await {
            // §7 long-lived guard: this is the ACTIVE media path (serve-webrtc), so rust.log must be
            // rotated mid-session, not only at init. Cheap stat every ~300 frames (~10s @ 30fps).
            frames = frames.wrapping_add(1);
            if frames.is_multiple_of(300) {
                crate::log::rotate_guard();
            }
            // DIAG: confirm the host actually forwards encoded frames to RTP (first few + every 30th).
            // AU size also tells keyframe (large) vs delta (small) — helps diagnose a black viewer.
            if frames <= 3 || frames.is_multiple_of(30) {
                tracing::info!("serve-webrtc: rtp frame #{frames} ({} bytes au)", au.len());
            }
            let sample = Sample {
                data: Bytes::from(au),
                duration: frame_dur,
                ..Default::default()
            };
            if track_w.write_sample(&sample).await.is_err() {
                break;
            }
        }
    });

    // --- create offer, send to browser ---
    let offer = pc.create_offer(None).await.map_err(|e| e.to_string())?;
    pc.set_local_description(offer.clone())
        .await
        .map_err(|e| e.to_string())?;
    let offer_msg = serde_json::json!({ "type": "offer", "sdp": offer.sdp }).to_string();
    ws_tx
        .send(Message::Text(offer_msg.into()))
        .await
        .map_err(|e| format!("send offer: {e}"))?;

    // --- signaling loop: pump PC->browser candidates and browser->PC messages ---
    loop {
        tokio::select! {
            Some(out) = sig_rx.recv() => {
                if ws_tx.send(Message::Text(out.into())).await.is_err() { break; }
            }
            msg = ws_rx.next() => {
                let msg = match msg { Some(Ok(m)) => m, _ => break };
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                let v: serde_json::Value = match serde_json::from_str(&text) { Ok(v) => v, Err(_) => continue };
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("answer") => {
                        if let Some(sdp) = v.get("sdp").and_then(|s| s.as_str()) {
                            let ans = RTCSessionDescription::answer(sdp.to_owned()).map_err(|e| e.to_string())?;
                            pc.set_remote_description(ans).await.map_err(|e| e.to_string())?;
                        }
                    }
                    Some("candidate") => {
                        if let Some(c) = v.get("candidate").and_then(|s| s.as_str()) {
                            let init = RTCIceCandidateInit {
                                candidate: c.to_owned(),
                                sdp_mid: v.get("sdpMid").and_then(|x| x.as_str()).map(|s| s.to_owned()),
                                sdp_mline_index: v.get("sdpMLineIndex").and_then(|x| x.as_u64()).map(|n| n as u16),
                                ..Default::default()
                            };
                            let _ = pc.add_ice_candidate(init).await;
                        }
                    }
                    _ => {}
                }
            }
            else => break,
        }
    }

    cap_handle.stop();
    let _ = pc.close().await;
    Ok(())
}

/// Per-session capture source: either a spawned `rp-screencap` child (default
/// standalone mode) or an AU-from-stdin reader thread (`RP_AU_STDIN=1`, the
/// in-app capture path). Both feed the same `au_tx`; `stop()` ends the session.
enum CaptureSource {
    Child(CaptureHandle),
    Stdin(StdinReaderHandle),
}
impl CaptureSource {
    fn stop(&self) {
        match self {
            CaptureSource::Child(h) => h.stop(),
            CaptureSource::Stdin(h) => h.stop(),
        }
    }
}

/// Write a one-line control message to **stdout** (the control channel to the
/// parent app in `RP_AU_STDIN=1` mode) and flush. stdout is reserved for these
/// control lines — the logger never writes to stdout, so this stays clean.
///
/// Concurrency: control lines are emitted from several places — the capture
/// start/stop writers AND the RTCP reader task ({"keyframe":true}) — possibly on
/// different threads. We take an explicit lock on the process-wide `Stdout` for the
/// whole write+flush so a control line is never interleaved/corrupted by another.
fn write_control(line: &str) {
    let out = std::io::stdout();
    let mut guard = out.lock();
    if guard.write_all(line.as_bytes()).is_err() || guard.flush().is_err() {
        tracing::warn!("serve-webrtc: failed to write control line to stdout");
    }
}

/// Handle to stop the AU-from-stdin reader. The reader thread exits on EOF/error
/// or when `stop()` flips the shared flag; `stop()` also emits `{"capture":"stop"}`
/// to the parent so it can stop the in-app CaptureEngine for this session.
struct StdinReaderHandle {
    stopped: Arc<std::sync::atomic::AtomicBool>,
}
impl StdinReaderHandle {
    fn stop(&self) {
        self.stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        write_control("{\"capture\":\"stop\"}\n");
    }
}

/// Start the AU-from-stdin reader for `RP_AU_STDIN=1` mode. Emits
/// `{"capture":"start"}` to stdout (the parent app then begins in-app capture),
/// then reads `[4B BE len][Annex-B AU]` frames from stdin and forwards each AU
/// into `au_tx` — the SAME framing/guard/`blocking_send` as `spawn_screencap`'s
/// reader thread. The thread returns on EOF/error or when `stop()` is called.
fn spawn_au_stdin_reader(au_tx: mpsc::Sender<Vec<u8>>) -> StdinReaderHandle {
    tracing::info!("serve-webrtc: AU-from-stdin mode (in-app capture); requesting capture start");
    write_control("{\"capture\":\"start\"}\n");

    let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopped_thread = stopped.clone();
    std::thread::Builder::new()
        .name("au-stdin-reader".into())
        .spawn(move || {
            let mut stdin = std::io::stdin();
            let mut len_buf = [0u8; 4];
            loop {
                if stopped_thread.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                if stdin.read_exact(&mut len_buf).is_err() {
                    break;
                }
                let len = u32::from_be_bytes(len_buf) as usize;
                if len == 0 || len > 64 * 1024 * 1024 {
                    break;
                }
                let mut au = vec![0u8; len];
                if stdin.read_exact(&mut au).is_err() {
                    break;
                }
                if au_tx.blocking_send(au).is_err() {
                    break;
                }
            }
        })
        .ok();

    StdinReaderHandle { stopped }
}

/// Handle to stop the capture/encode helper process.
struct CaptureHandle {
    child: std::sync::Mutex<std::process::Child>,
}
impl CaptureHandle {
    fn stop(&self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
        }
    }
}

/// Spawn `rp-screencap` (ScreenCaptureKit capture + VideoToolbox H.264 in ONE
/// process: IOSurface zero-copy, GPU-scaled, on-change — no raw-frame pipe, no
/// Rust-side capture/swizzle) and stream its Annex-B access units to `au_tx`.
fn spawn_screencap(
    fps: u32,
    bitrate: u32,
    scale: f32,
    au_tx: mpsc::Sender<Vec<u8>>,
) -> Result<CaptureHandle, String> {
    let bin = screencap_path();
    tracing::info!("serve-webrtc: capture+encode '{bin}' @ {fps}fps {bitrate}bps scale={scale}");
    let mut child = Command::new(&bin)
        .arg(fps.to_string())
        .arg(bitrate.to_string())
        .arg(format!("{scale}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn '{bin}': {e}"))?;
    let mut stdout = child.stdout.take().ok_or("no helper stdout")?;

    // reader thread: helper stdout (length-prefixed Annex-B AUs) -> au_tx
    std::thread::Builder::new()
        .name("rtp-reader".into())
        .spawn(move || {
            let mut len_buf = [0u8; 4];
            loop {
                if stdout.read_exact(&mut len_buf).is_err() {
                    break;
                }
                let len = u32::from_be_bytes(len_buf) as usize;
                if len == 0 || len > 64 * 1024 * 1024 {
                    break;
                }
                let mut au = vec![0u8; len];
                if stdout.read_exact(&mut au).is_err() {
                    break;
                }
                if au_tx.blocking_send(au).is_err() {
                    break;
                }
            }
        })
        .map_err(|e| format!("spawn reader thread: {e}"))?;

    Ok(CaptureHandle {
        child: std::sync::Mutex::new(child),
    })
}
