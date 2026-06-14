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

fn encoder_path() -> String {
    if let Ok(p) = std::env::var("RP_VT_ENCODE") {
        return p;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let deployed = format!("{home}/.remote-pair/bin/rp-vt-encode");
    if std::path::Path::new(&deployed).exists() {
        return deployed;
    }
    "rp-vt-encode".to_string()
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
    eprintln!("remote-pair-screen serve-webrtc: signaling ws://{addr} (H.264/WebRTC UDP)");
    eprintln!("  reach signaling over:  ssh -L {port}:127.0.0.1:{port} <host>");
    eprintln!("  media flows P2P over UDP/ICE (host-candidate, loopback/LAN/VPN)");

    // One browser (pair session is 1:1). Each signaling connection gets a fresh
    // PeerConnection + encoder pipeline; teardown on disconnect.
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(x) => x,
            Err(e) => {
                eprintln!("serve-webrtc: accept error: {e}");
                continue;
            }
        };
        eprintln!("serve-webrtc: signaling client {peer} connected");
        if let Err(e) = handle_session(stream, fps, bitrate, scale).await {
            eprintln!("serve-webrtc: session ended: {e}");
        }
        eprintln!("serve-webrtc: signaling client {peer} done");
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
        "remotepair-screen".to_owned(),
    ));
    pc.add_track(track.clone() as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|e| e.to_string())?;

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
    pc.on_peer_connection_state_change(Box::new(move |s| {
        eprintln!("serve-webrtc: peer connection state: {s}");
        Box::pin(async {})
    }));

    // --- encoder pipeline (spawned once we know dimensions) ---
    let (au_tx, mut au_rx) = mpsc::channel::<Vec<u8>>(16);
    let cap_handle = spawn_capture_encoder(fps, bitrate, scale, au_tx)?;

    // rtp task: forward access units to the track as H264 samples
    let track_w = track.clone();
    let frame_dur = Duration::from_secs_f64(1.0 / fps as f64);
    tokio::spawn(async move {
        while let Some(au) = au_rx.recv().await {
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

/// Handle to stop the capture/encoder threads.
struct CaptureHandle {
    stop: Arc<std::sync::atomic::AtomicBool>,
}
impl CaptureHandle {
    fn stop(&self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Spawn the encoder process + capture thread (feeds raw BGRA) + reader thread
/// (emits Annex-B access units to `au_tx`).
fn spawn_capture_encoder(
    fps: u32,
    bitrate: u32,
    scale: f32,
    au_tx: mpsc::Sender<Vec<u8>>,
) -> Result<CaptureHandle, String> {
    let monitor = crate::primary_monitor()?;
    let first = monitor
        .capture_image()
        .map_err(|e| format!("initial capture (Screen Recording grant?): {e}"))?;
    let (cap_w, cap_h) = (first.width(), first.height());
    let enc_w = ((cap_w as f32 * scale) as u32).max(2) & !1;
    let enc_h = ((cap_h as f32 * scale) as u32).max(2) & !1;

    let enc_bin = encoder_path();
    eprintln!("serve-webrtc: encoder '{enc_bin}' {enc_w}x{enc_h} @ {fps}fps {bitrate}bps");
    let mut child = Command::new(&enc_bin)
        .arg(enc_w.to_string())
        .arg(enc_h.to_string())
        .arg(fps.to_string())
        .arg(bitrate.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn encoder '{enc_bin}': {e}"))?;
    let mut enc_stdin = child.stdin.take().ok_or("no encoder stdin")?;
    let mut enc_stdout = child.stdout.take().ok_or("no encoder stdout")?;

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let frame_interval = Duration::from_secs_f64(1.0 / fps as f64);

    // capture thread: xcap -> swizzle BGRA -> encoder stdin
    {
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("rtp-capture".into())
            .spawn(move || {
                let mut prev: Vec<u8> = Vec::new();
                let mut bgra: Vec<u8> = Vec::with_capacity((enc_w * enc_h * 4) as usize);
                let mut frame = Some(first);
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    let t0 = std::time::Instant::now();
                    let img = match frame.take() {
                        Some(f) => f,
                        None => match monitor.capture_image() {
                            Ok(f) => f,
                            Err(_) => {
                                std::thread::sleep(frame_interval);
                                continue;
                            }
                        },
                    };
                    let raw = img.as_raw();
                    if !prev.is_empty() && prev.as_slice() == raw.as_slice() {
                        if let Some(r) = frame_interval.checked_sub(t0.elapsed()) {
                            std::thread::sleep(r);
                        }
                        continue;
                    }
                    prev.clear();
                    prev.extend_from_slice(raw);
                    let src: std::borrow::Cow<xcap::image::RgbaImage> = if scale < 1.0 {
                        std::borrow::Cow::Owned(xcap::image::imageops::resize(
                            &img,
                            enc_w,
                            enc_h,
                            xcap::image::imageops::FilterType::Triangle,
                        ))
                    } else {
                        std::borrow::Cow::Borrowed(&img)
                    };
                    bgra.clear();
                    for px in src.as_raw().chunks_exact(4) {
                        bgra.push(px[2]);
                        bgra.push(px[1]);
                        bgra.push(px[0]);
                        bgra.push(px[3]);
                    }
                    if enc_stdin.write_all(&bgra).is_err() {
                        break;
                    }
                    if let Some(r) = frame_interval.checked_sub(t0.elapsed()) {
                        std::thread::sleep(r);
                    }
                }
            })
            .map_err(|e| format!("spawn capture thread: {e}"))?;
    }

    // reader thread: encoder stdout -> au_tx
    std::thread::Builder::new()
        .name("rtp-reader".into())
        .spawn(move || {
            let mut len_buf = [0u8; 4];
            loop {
                if enc_stdout.read_exact(&mut len_buf).is_err() {
                    break;
                }
                let len = u32::from_be_bytes(len_buf) as usize;
                if len == 0 || len > 64 * 1024 * 1024 {
                    break;
                }
                let mut au = vec![0u8; len];
                if enc_stdout.read_exact(&mut au).is_err() {
                    break;
                }
                if au_tx.blocking_send(au).is_err() {
                    break;
                }
            }
            let _ = child.kill();
        })
        .map_err(|e| format!("spawn reader thread: {e}"))?;

    Ok(CaptureHandle { stop })
}
