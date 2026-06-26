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

use std::io::{BufRead, BufReader, Read, Write};
use std::net::SocketAddr;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tokio_util::sync::CancellationToken;

use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

use crate::control::{
    app_control_frame, AppControlFrame, CaptureConfig, CaptureErrorKind, ControlClient,
    ControlError, StartedInfo,
};

const CONNECT_DEADLINE: Duration = Duration::from_secs(10);
const SESSION_TOKEN_MIN_LEN: usize = 24;
const SESSION_TOKEN_MAX_LEN: usize = 128;
const APP_CONTROL_FD_ENV: &str = "RP_AU_CONTROL_FD";
const MAX_AU_FRAME_LEN: usize = 64 * 1024 * 1024;
const MAX_CONTROL_FRAME_LEN: usize = 1024 * 1024;

type SignalingWs = WebSocketStream<tokio::net::TcpStream>;
type WsTx = SplitSink<SignalingWs, Message>;
type WsRx = SplitStream<SignalingWs>;
type InputTx = std::sync::mpsc::Sender<Vec<u8>>;
type InputRx = std::sync::mpsc::Receiver<Vec<u8>>;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SessionToken(String);

impl SessionToken {
    fn parse(raw: &str) -> Result<Self, SessionError> {
        let token = raw.trim();
        if token.len() < SESSION_TOKEN_MIN_LEN || token.len() > SESSION_TOKEN_MAX_LEN {
            return Err(SessionError::InvalidToken);
        }
        if !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        {
            return Err(SessionError::InvalidToken);
        }
        Ok(Self(token.to_owned()))
    }

    fn redacted(&self) -> String {
        let head: String = self.0.chars().take(6).collect();
        format!("{head}…")
    }
}

#[derive(Debug, thiserror::Error)]
enum SessionError {
    #[error("missing signaling session token")]
    MissingToken,
    #[error("invalid signaling session token")]
    InvalidToken,
    #[error("signaling session token mismatch")]
    TokenMismatch,
    #[error("connect deadline exceeded")]
    ConnectDeadlineExceeded,
    #[error("session superseded")]
    Superseded,
    #[error("peer failed: {0}")]
    PeerFailed(String),
    #[error("signaling closed")]
    SignalingClosed,
    #[error("websocket handshake: {0}")]
    WsHandshake(String),
    #[error("webrtc: {0}")]
    WebRtc(String),
    #[error("capture: {0}")]
    Capture(String),
    #[error("status serialization: {0}")]
    StatusSerialize(String),
}

struct CaptureStartError {
    status: Option<RdStatus>,
    error: SessionError,
}

impl CaptureStartError {
    fn with_status(status: RdStatus, error: SessionError) -> Self {
        Self {
            status: Some(status),
            error,
        }
    }

    fn without_status(error: SessionError) -> Self {
        Self {
            status: None,
            error,
        }
    }

    fn capture_failed(capture_kind: CaptureErrorKind, reason: String, error: SessionError) -> Self {
        Self::with_status(
            RdStatus::CaptureFailed {
                capture_kind,
                reason: bounded_reason(reason),
            },
            error,
        )
    }
}

impl From<webrtc::Error> for SessionError {
    fn from(value: webrtc::Error) -> Self {
        SessionError::WebRtc(value.to_string())
    }
}

impl From<ControlError> for SessionError {
    fn from(value: ControlError) -> Self {
        match value {
            ControlError::CaptureFailed { kind, reason } => {
                SessionError::Capture(format!("{kind:?}: {reason}"))
            }
            ControlError::Superseded { .. } => SessionError::Superseded,
            other => SessionError::Capture(other.to_string()),
        }
    }
}

struct AcceptedSignaling {
    token: SessionToken,
    capture_config: CaptureConfig,
    ws: SignalingWs,
}

struct ActiveSession {
    seq: u64,
    token: SessionToken,
    cancel: CancellationToken,
}

struct SessionDone {
    seq: u64,
    token: SessionToken,
    result: Result<(), SessionError>,
}

enum SignalingAcceptResult {
    Accepted {
        seq: u64,
        peer: SocketAddr,
        signaling: Box<AcceptedSignaling>,
    },
    Rejected {
        seq: u64,
        peer: SocketAddr,
        error: SessionError,
    },
}

enum PeerEvent {
    Connected,
    Terminal(PeerFailureKind),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum PeerFailureKind {
    Failed,
    Closed,
}

impl std::fmt::Display for PeerFailureKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            PeerFailureKind::Failed => "failed",
            PeerFailureKind::Closed => "closed",
        };
        f.write_str(label)
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum RdStatus {
    CaptureFailed {
        #[serde(rename = "captureKind")]
        capture_kind: CaptureErrorKind,
        reason: String,
    },
    PeerFailed {
        peer: PeerFailureKind,
        reason: String,
    },
    Superseded {
        reason: String,
    },
    InputReady {
        helper: String,
        #[serde(rename = "axTrusted")]
        ax_trusted: bool,
        #[serde(rename = "displayId")]
        display_id: Option<u32>,
        width: Option<f64>,
        height: Option<f64>,
    },
    InputFailed {
        reason: String,
    },
}

#[derive(Serialize)]
struct SignalingStatus<'a> {
    #[serde(rename = "type")]
    message_type: &'static str,
    #[serde(flatten)]
    status: &'a RdStatus,
}

impl RdStatus {
    fn to_signaling_text(&self) -> Result<String, SessionError> {
        serde_json::to_string(&SignalingStatus {
            message_type: "status",
            status: self,
        })
        .map_err(|e| SessionError::StatusSerialize(e.to_string()))
    }
}

#[derive(Debug, Deserialize)]
struct InputHelperStatus {
    kind: String,
    reason: Option<String>,
    #[serde(rename = "axTrusted")]
    ax_trusted: Option<bool>,
    #[serde(rename = "displayId")]
    display_id: Option<u32>,
    width: Option<f64>,
    height: Option<f64>,
}

struct SignalingIo {
    ws_tx: WsTx,
    ws_rx: WsRx,
    sig_rx: mpsc::UnboundedReceiver<String>,
}

struct PeerResources {
    pc: Arc<webrtc::peer_connection::RTCPeerConnection>,
    _input_dcs: Vec<Arc<webrtc::data_channel::RTCDataChannel>>,
    input_rx: Option<InputRx>,
}

struct NegotiatingSession {
    seq: u64,
    token: SessionToken,
    started: Instant,
    io: SignalingIo,
    sig_tx: mpsc::UnboundedSender<String>,
    peer: PeerResources,
    state_rx: mpsc::UnboundedReceiver<PeerEvent>,
    au_tx: mpsc::Sender<Vec<u8>>,
    capture_config: CaptureConfig,
    control: ControlClient,
    cancel: CancellationToken,
}

struct ConnectedSession {
    token: SessionToken,
    started: Instant,
    io: SignalingIo,
    peer: PeerResources,
    state_rx: mpsc::UnboundedReceiver<PeerEvent>,
    _capture: CaptureSource,
    _caffeinate: CaffeinateGuard,
    cancel: CancellationToken,
}

enum Session {
    Negotiating(NegotiatingSession),
    Connected(ConnectedSession),
}

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

/// Resolve the remote-input injector helper (`rp-input-inject`).
/// Order: `$RP_INPUT_INJECT` → bundle sibling (`current_exe` dir) →
/// `~/.xpair/host/bin`. No bare PATH fallback: clean installs must use the
/// signed helper bundled with XpairHost.app, and development can set
/// `RP_INPUT_INJECT` explicitly.
fn input_helper_path() -> Result<String, String> {
    if let Ok(p) = std::env::var("RP_INPUT_INJECT") {
        let p = p.trim();
        if !p.is_empty() {
            return Ok(p.to_string());
        }
    }
    if let Some(p) = sibling_helper("rp-input-inject") {
        return Ok(p);
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let deployed = format!("{home}/.xpair/host/bin/rp-input-inject");
    if std::path::Path::new(&deployed).exists() {
        return Ok(deployed);
    }
    Err(format!(
        "rp-input-inject not found (expected bundle sibling or {deployed}; set RP_INPUT_INJECT for development)"
    ))
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

fn expected_token_from_arg(raw: &str) -> Result<SessionToken, String> {
    let token = if let Some(path) = raw.strip_prefix('@') {
        std::fs::read_to_string(path)
            .map_err(|e| format!("read signaling token file '{path}': {e}"))?
    } else {
        raw.to_string()
    };
    SessionToken::parse(&token).map_err(|e| e.to_string())
}

pub fn run(port: u16, fps: u32, bitrate: u32, scale: f32, token: String) -> Result<(), String> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio runtime: {e}"))?;
    rt.block_on(async move { run_async(port, fps, bitrate, scale, token).await })
}

async fn run_async(
    port: u16,
    fps: u32,
    bitrate: u32,
    scale: f32,
    token: String,
) -> Result<(), String> {
    let fps = fps.clamp(1, 120);
    let scale = scale.clamp(0.1, 1.0);
    let capture_config = CaptureConfig {
        fps,
        bitrate,
        scale,
    };
    let expected_token = expected_token_from_arg(&token)?;

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;
    tracing::info!("screen serve-webrtc: signaling ws://{addr} (H.264/WebRTC UDP)");
    tracing::info!("  reach signaling over:  ssh -L {port}:127.0.0.1:{port} <host>");
    tracing::info!("  media flows P2P over UDP/ICE (host-candidate, loopback/LAN/VPN)");
    tracing::info!("  signaling token: required");

    let (ready_tx, mut ready_rx) = mpsc::unbounded_channel::<SignalingAcceptResult>();
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<SessionDone>();
    let mut active: Option<ActiveSession> = None;
    let mut next_session_seq: u64 = 0;

    // One browser (pair session is 1:1). The accept loop is the arbiter: it owns
    // the active session identity, and a new valid signaling connection cancels
    // the prior one before installing itself.
    loop {
        crate::log::rotate_guard(); // §7 long-lived guard: also rotate between signaling sessions
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, peer) = match accepted {
                    Ok(x) => x,
                    Err(e) => {
                        tracing::warn!("serve-webrtc: accept error: {e}");
                        continue;
                    }
                };
                tracing::info!("serve-webrtc: tcp client {peer} connected");
                next_session_seq = next_session_seq.wrapping_add(1);
                let seq = next_session_seq;
                let ready_tx = ready_tx.clone();
                let expected_token = expected_token.clone();
                tokio::spawn(async move {
                    let result = tokio::time::timeout(
                        CONNECT_DEADLINE,
                        accept_signaling(stream, &expected_token, capture_config),
                    )
                    .await
                    .map_err(|_| SessionError::ConnectDeadlineExceeded)
                    .and_then(|x| x);
                    let message = match result {
                        Ok(signaling) => SignalingAcceptResult::Accepted {
                            seq,
                            peer,
                            signaling: Box::new(signaling),
                        },
                        Err(error) => SignalingAcceptResult::Rejected { seq, peer, error },
                    };
                    let _ = ready_tx.send(message);
                });
            }
            Some(ready) = ready_rx.recv() => {
                let (seq, peer, accepted) = match ready {
                    SignalingAcceptResult::Accepted { seq, peer, signaling } => (seq, peer, *signaling),
                    SignalingAcceptResult::Rejected { seq, peer, error } => {
                        tracing::warn!("serve-webrtc: rejected signaling client {peer} seq={seq}: {error}");
                        continue;
                    }
                };
                if active.as_ref().is_some_and(|s| seq < s.seq) {
                    tracing::info!(
                        "serve-webrtc: dropping late accepted session {} seq={seq}",
                        accepted.token.redacted()
                    );
                    continue;
                }
                tracing::info!(
                    "serve-webrtc: signaling client {peer} accepted as session {} seq={seq}",
                    accepted.token.redacted(),
                );
                if let Some(old) = active.take() {
                    tracing::info!(
                        "serve-webrtc: replacing active session {} with {}",
                        old.token.redacted(),
                        accepted.token.redacted()
                    );
                    old.cancel.cancel();
                }
                let token = accepted.token.clone();
                let cancel = CancellationToken::new();
                active = Some(ActiveSession {
                    seq,
                    token: token.clone(),
                    cancel: cancel.clone(),
                });
                let done_tx = done_tx.clone();
                tokio::spawn(async move {
                    let result = serve_session(seq, accepted, cancel).await;
                    let _ = done_tx.send(SessionDone { seq, token, result });
                });
            }
            Some(done) = done_rx.recv() => {
                match &done.result {
                    Ok(()) => tracing::info!(
                        "serve-webrtc: session {} seq={} ended cleanly",
                        done.token.redacted(),
                        done.seq
                    ),
                    Err(SessionError::Superseded) => tracing::info!(
                        "serve-webrtc: session {} seq={} superseded",
                        done.token.redacted(),
                        done.seq
                    ),
                    Err(e) => tracing::warn!(
                        "serve-webrtc: session {} seq={} ended: {e}",
                        done.token.redacted(),
                        done.seq
                    ),
                }
                if active
                    .as_ref()
                    .is_some_and(|s| s.seq == done.seq && s.token == done.token)
                {
                    active = None;
                }
            }
        }
    }
}

#[allow(clippy::result_large_err)]
async fn accept_signaling(
    stream: tokio::net::TcpStream,
    expected_token: &SessionToken,
    default_capture_config: CaptureConfig,
) -> Result<AcceptedSignaling, SessionError> {
    let mut parsed_token: Option<SessionToken> = None;
    let mut parsed_capture_config = default_capture_config;
    let ws = tokio_tungstenite::accept_hdr_async(stream, |req: &Request, response: Response| {
        let token = match parse_request_token(req, expected_token) {
            Ok(token) => token,
            Err(e) => return Err(session_rejection(&e)),
        };
        parsed_capture_config = capture_config_from_request(req, default_capture_config);
        parsed_token = Some(token);
        Ok(response)
    })
    .await
    .map_err(|e| SessionError::WsHandshake(e.to_string()))?;
    let token = parsed_token.ok_or(SessionError::MissingToken)?;
    Ok(AcceptedSignaling {
        token,
        capture_config: parsed_capture_config,
        ws,
    })
}

fn parse_request_token(
    req: &Request,
    expected_token: &SessionToken,
) -> Result<SessionToken, SessionError> {
    let raw = req
        .uri()
        .query()
        .and_then(token_from_query)
        .ok_or(SessionError::MissingToken)?;
    let token = SessionToken::parse(raw)?;
    if expected_token != &token {
        return Err(SessionError::TokenMismatch);
    }
    Ok(token)
}

fn token_from_query(query: &str) -> Option<&str> {
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == "token").then_some(value)
    })
}

fn query_value<'a>(query: &'a str, needle: &str) -> Option<&'a str> {
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == needle).then_some(value)
    })
}

fn capture_config_from_request(req: &Request, default: CaptureConfig) -> CaptureConfig {
    let Some(query) = req.uri().query() else {
        return default;
    };
    let fps = query_value(query, "fps")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(default.fps)
        .clamp(1, 120);
    let bitrate = query_value(query, "bitrate")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(default.bitrate)
        .max(100_000);
    let scale = query_value(query, "scale")
        .and_then(|v| v.parse::<f32>().ok())
        .filter(|v| v.is_finite())
        .unwrap_or(default.scale)
        .clamp(0.1, 1.0);
    CaptureConfig {
        fps,
        bitrate,
        scale,
    }
}

fn is_h264_keyframe_au(au: &[u8]) -> bool {
    let mut i = 0usize;
    while i + 3 < au.len() {
        let start_code_len = if i + 4 <= au.len()
            && au[i] == 0
            && au[i + 1] == 0
            && au[i + 2] == 0
            && au[i + 3] == 1
        {
            4
        } else if au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 1 {
            3
        } else {
            i += 1;
            continue;
        };
        let nal_index = i + start_code_len;
        if nal_index < au.len() {
            let nal_type = au[nal_index] & 0x1f;
            if nal_type == 5 {
                return true;
            }
        }
        i = nal_index.saturating_add(1);
    }
    false
}

fn forward_au_latest(
    au_tx: &mpsc::Sender<Vec<u8>>,
    au: Vec<u8>,
    dropped_delta_frames: &mut u64,
) -> bool {
    match au_tx.try_send(au) {
        Ok(()) => true,
        Err(mpsc::error::TrySendError::Closed(_)) => false,
        Err(mpsc::error::TrySendError::Full(au)) => {
            if is_h264_keyframe_au(&au) {
                au_tx.blocking_send(au).is_ok()
            } else {
                *dropped_delta_frames = dropped_delta_frames.wrapping_add(1);
                if *dropped_delta_frames == 1 || (*dropped_delta_frames).is_multiple_of(300) {
                    tracing::warn!(
                        "serve-webrtc: dropped {} stale delta AU(s) before RTP",
                        *dropped_delta_frames
                    );
                }
                true
            }
        }
    }
}

fn read_len_prefixed_frame<R: Read>(reader: &mut R, max_len: usize) -> Option<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    if reader.read_exact(&mut len_buf).is_err() {
        return None;
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 || len > max_len {
        return None;
    }
    let mut frame = vec![0u8; len];
    if reader.read_exact(&mut frame).is_err() {
        return None;
    }
    Some(frame)
}

fn relay_app_control_frame(
    frame: AppControlFrame,
    sig_tx: &mpsc::UnboundedSender<String>,
    control: &ControlClient,
) {
    match frame {
        AppControlFrame::Ack(ack) => control.deliver_ack(ack),
        AppControlFrame::CaptureError(event) => {
            tracing::warn!(
                "serve-webrtc: relaying host capture error gen={}: {:?}: {}",
                event.gen,
                event.kind,
                event.reason
            );
            queue_status(
                sig_tx,
                RdStatus::CaptureFailed {
                    capture_kind: event.kind,
                    reason: bounded_reason(event.reason),
                },
            );
        }
    }
}

fn read_app_control_stream<R: Read>(
    reader: &mut R,
    sig_tx: &mpsc::UnboundedSender<String>,
    control: &ControlClient,
) {
    while let Some(frame) = read_len_prefixed_frame(reader, MAX_CONTROL_FRAME_LEN) {
        if let Some(frame) = app_control_frame(&frame) {
            relay_app_control_frame(frame, sig_tx, control);
        } else {
            tracing::debug!("serve-webrtc: ignoring non-control frame on app control fd");
        }
    }
}

#[cfg(unix)]
fn spawn_app_control_reader_from_env(
    sig_tx: mpsc::UnboundedSender<String>,
    control: ControlClient,
) -> bool {
    use std::os::fd::FromRawFd;

    let raw_fd = match std::env::var(APP_CONTROL_FD_ENV) {
        Ok(raw) => raw,
        Err(_) => return false,
    };
    let Some(fd) = raw_fd.parse::<i32>().ok().filter(|fd| *fd > 2) else {
        tracing::warn!("serve-webrtc: invalid {APP_CONTROL_FD_ENV}={raw_fd:?}; falling back to stdin control frames");
        return false;
    };
    tracing::info!("serve-webrtc: app control reader using fd {fd}");
    // SAFETY: ScreenServer passes an owned child-side pipe fd via RP_AU_CONTROL_FD.
    let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
    match std::thread::Builder::new()
        .name("app-control-reader".into())
        .spawn(move || read_app_control_stream(&mut file, &sig_tx, &control))
    {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!("serve-webrtc: failed to spawn app control reader: {e}");
            false
        }
    }
}

#[cfg(not(unix))]
fn spawn_app_control_reader_from_env(
    _sig_tx: mpsc::UnboundedSender<String>,
    _control: ControlClient,
) -> bool {
    false
}

fn bounded_reason(raw: impl Into<String>) -> String {
    const MAX_REASON: usize = 800;
    let reason = raw.into();
    if reason.chars().count() <= MAX_REASON {
        return reason;
    }
    let mut shortened: String = reason.chars().take(MAX_REASON).collect();
    shortened.push_str("...");
    shortened
}

fn status_from_input_helper_line(line: &str, helper: &str) -> Option<RdStatus> {
    let payload = line.strip_prefix("RPINPUT ")?;
    let status: InputHelperStatus = serde_json::from_str(payload).ok()?;
    match status.kind.as_str() {
        "ready" => Some(RdStatus::InputReady {
            helper: helper.to_string(),
            ax_trusted: status.ax_trusted.unwrap_or(true),
            display_id: status.display_id,
            width: status.width,
            height: status.height,
        }),
        "error" => Some(RdStatus::InputFailed {
            reason: bounded_reason(
                status
                    .reason
                    .unwrap_or_else(|| "remote input helper failed".to_string()),
            ),
        }),
        _ => None,
    }
}

fn wire_input_data_channel(dc: &Arc<RTCDataChannel>, in_tx: InputTx) {
    let label = dc.label().to_string();
    dc.on_open(Box::new(move || {
        tracing::info!("serve-webrtc: input DataChannel '{label}' open");
        Box::pin(async {})
    }));
    dc.on_message(Box::new(move |msg: DataChannelMessage| {
        let tx = in_tx.clone();
        Box::pin(async move {
            let _ = tx.send(msg.data.to_vec());
        })
    }));
}

fn should_forward_input_message(json: &[u8], last_applied_seq: &mut u64) -> bool {
    let parsed: serde_json::Value = match serde_json::from_slice(json) {
        Ok(value) => value,
        Err(_) => return true,
    };
    let seq = match parsed.get("seq").and_then(serde_json::Value::as_u64) {
        Some(seq) => seq,
        None => return true,
    };
    let kind = parsed.get("t").and_then(serde_json::Value::as_str);
    if kind == Some("m") && seq <= *last_applied_seq {
        tracing::debug!(
            "serve-webrtc: dropping stale rp-move seq={seq} last_applied_seq={}",
            *last_applied_seq
        );
        return false;
    }
    *last_applied_seq = (*last_applied_seq).max(seq);
    true
}

async fn configure_input_data_channels(
    pc: &Arc<webrtc::peer_connection::RTCPeerConnection>,
) -> Result<(Vec<Arc<RTCDataChannel>>, InputRx), SessionError> {
    let (in_tx, in_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let incoming_tx = in_tx.clone();
    pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
        let tx = incoming_tx.clone();
        Box::pin(async move {
            let label = dc.label().to_string();
            if label == "rp-ctl" || label == "rp-move" {
                wire_input_data_channel(&dc, tx);
            } else {
                tracing::debug!("serve-webrtc: ignoring unexpected input DataChannel '{label}'");
            }
        })
    }));

    let ctl = pc
        .create_data_channel("rp-ctl", None)
        .await
        .map_err(SessionError::from)?;
    let mv_init = RTCDataChannelInit {
        ordered: Some(false),
        max_retransmits: Some(0),
        ..Default::default()
    };
    let mv = pc
        .create_data_channel("rp-move", Some(mv_init))
        .await
        .map_err(SessionError::from)?;
    for dc in [&ctl, &mv] {
        wire_input_data_channel(dc, in_tx.clone());
    }
    Ok((vec![ctl, mv], in_rx))
}

fn spawn_input_helper(
    input_rx: InputRx,
    sig_tx: mpsc::UnboundedSender<String>,
    display_id: Option<u32>,
) {
    match input_helper_path() {
        Ok(bin) => {
            let mut command = Command::new(&bin);
            command.stdin(Stdio::piped()).stderr(Stdio::piped());
            if let Some(display_id) = display_id {
                command.env("RP_CAPTURE_DISPLAY_ID", display_id.to_string());
            }
            match command.spawn() {
                Ok(mut child) => {
                    if let Some(stderr) = child.stderr.take() {
                        let sig_tx = sig_tx.clone();
                        let helper = bin.clone();
                        std::thread::Builder::new()
                            .name("rp-input-stderr".into())
                            .spawn(move || {
                                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                                    if let Some(status) =
                                        status_from_input_helper_line(&line, &helper)
                                    {
                                        queue_status(&sig_tx, status);
                                    } else if line.starts_with("RPIN ") {
                                        tracing::debug!("serve-webrtc input: {line}");
                                    } else {
                                        tracing::info!("serve-webrtc input: {line}");
                                    }
                                }
                            })
                            .ok();
                    }
                    if let Some(mut stdin) = child.stdin.take() {
                        std::thread::Builder::new()
                            .name("rp-input-writer".into())
                            .spawn(move || {
                                let mut last_applied_seq = 0;
                                while let Ok(json) = input_rx.recv() {
                                    if !should_forward_input_message(&json, &mut last_applied_seq) {
                                        continue;
                                    }
                                    let len = (json.len() as u32).to_be_bytes();
                                    if stdin.write_all(&len).is_err()
                                        || stdin.write_all(&json).is_err()
                                    {
                                        break;
                                    }
                                }
                                drop(stdin);
                                let _ = child.wait();
                            })
                            .ok();
                    } else {
                        queue_status(
                            &sig_tx,
                            RdStatus::InputFailed {
                                reason: format!("input helper '{bin}' did not expose stdin"),
                            },
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                Err(e) => {
                    let reason =
                        format!("input helper '{bin}' spawn failed (remote input disabled): {e}");
                    tracing::warn!("serve-webrtc: {reason}");
                    queue_status(&sig_tx, RdStatus::InputFailed { reason });
                }
            }
        }
        Err(reason) => {
            tracing::warn!("serve-webrtc: {reason}");
            queue_status(&sig_tx, RdStatus::InputFailed { reason });
        }
    }
}

fn queue_status(sig_tx: &mpsc::UnboundedSender<String>, status: RdStatus) {
    match status.to_signaling_text() {
        Ok(text) => {
            let _ = sig_tx.send(text);
        }
        Err(e) => tracing::warn!("serve-webrtc: could not serialize status: {e}"),
    }
}

async fn send_status_ws(ws_tx: &mut WsTx, status: RdStatus) -> Result<(), SessionError> {
    let text = status.to_signaling_text()?;
    ws_tx
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| SessionError::WsHandshake(format!("send status: {e}")))
}

fn session_rejection(error: &SessionError) -> ErrorResponse {
    let status = match error {
        SessionError::MissingToken | SessionError::InvalidToken => StatusCode::UNAUTHORIZED,
        SessionError::TokenMismatch => StatusCode::FORBIDDEN,
        _ => StatusCode::BAD_REQUEST,
    };
    let mut response = ErrorResponse::new(Some(error.to_string()));
    *response.status_mut() = status;
    response
}

async fn serve_session(
    seq: u64,
    accepted: AcceptedSignaling,
    cancel: CancellationToken,
) -> Result<(), SessionError> {
    let token = accepted.token;
    let capture_config = accepted.capture_config;
    let ws = accepted.ws;
    let (mut ws_tx, ws_rx) = ws.split();
    let control = ControlClient::stdout();

    // --- build webrtc API with H264 ---
    let mut m = MediaEngine::default();
    m.register_default_codecs()?;
    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut m)?;
    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();
    let pc = Arc::new(
        api.new_peer_connection(RTCConfiguration::default())
            .await
            .map_err(SessionError::from)?,
    );

    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_H264.to_owned(),
            clock_rate: 90000,
            sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                .to_owned(),
            ..Default::default()
        },
        "video".to_owned(),
        "xpair-screen".to_owned(),
    ));
    let rtp_sender = pc
        .add_track(track.clone() as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(SessionError::from)?;

    // RTCP reader: the client sends PictureLossIndication / FullIntraRequest when it
    // loses a keyframe (e.g. a packet of the 76KB IDR dropped on a lossy link). Forward
    // that as a keyframe control op so the parent app forces a fresh IDR —
    // otherwise the remote viewer stays BLACK forever. read_rtcp() returning Err ends
    // the task (session over). In standalone mode (no RP_AU_STDIN) the parent ignores
    // the control op harmlessly; the loop still drains RTCP as webrtc-rs expects.
    {
        let rtp_sender = rtp_sender.clone();
        let control = control.clone();
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
                        control.keyframe_noack(seq);
                    }
                }
            }
            tracing::info!("serve-webrtc: RTCP reader ended (sender closed)");
        });
    }

    // --- ICE candidate trickle: PC -> browser (via an mpsc to the WS writer) ---
    let (sig_tx, sig_rx) = mpsc::unbounded_channel::<String>();
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
    // Peer-state callback is a gate, not a shared flag: Connected is delivered
    // over a channel, and only that transition can construct ConnectedSession.
    let (state_tx, state_rx) = mpsc::unbounded_channel::<PeerEvent>();
    pc.on_peer_connection_state_change(Box::new(move |s| {
        use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
        tracing::info!("serve-webrtc: peer connection state: {s}");
        match s {
            RTCPeerConnectionState::Connected => {
                let _ = state_tx.send(PeerEvent::Connected);
            }
            RTCPeerConnectionState::Disconnected => {}
            RTCPeerConnectionState::Failed => {
                let _ = state_tx.send(PeerEvent::Terminal(PeerFailureKind::Failed));
            }
            RTCPeerConnectionState::Closed => {
                let _ = state_tx.send(PeerEvent::Terminal(PeerFailureKind::Closed));
            }
            _ => {}
        }
        Box::pin(async {})
    }));

    let (au_tx, mut au_rx) = mpsc::channel::<Vec<u8>>(16);

    // rtp task: forward access units to the track as H264 samples
    let track_w = track.clone();
    let frame_dur = Duration::from_secs_f64(1.0 / capture_config.fps as f64);
    tokio::spawn(async move {
        let mut frames: u64 = 0;
        let mut deferred_after_keyframe: Option<Vec<u8>> = None;
        loop {
            let first_au = if let Some(deferred) = deferred_after_keyframe.take() {
                deferred
            } else {
                match au_rx.recv().await {
                    Some(au) => au,
                    None => break,
                }
            };
            let (mut latest_keyframe, mut latest_delta) = if is_h264_keyframe_au(&first_au) {
                (Some(first_au), None)
            } else {
                (None, Some(first_au))
            };
            let mut dropped_queued = 0u64;
            while let Ok(newer) = au_rx.try_recv() {
                dropped_queued = dropped_queued.wrapping_add(1);
                if is_h264_keyframe_au(&newer) {
                    latest_keyframe = Some(newer);
                    latest_delta = None;
                } else {
                    latest_delta = Some(newer);
                }
            }
            if dropped_queued > 0 {
                tracing::debug!("serve-webrtc: dropped {dropped_queued} queued stale AU(s)");
            }
            let au = if let Some(keyframe) = latest_keyframe {
                deferred_after_keyframe = latest_delta;
                keyframe
            } else if let Some(delta) = latest_delta {
                delta
            } else {
                continue;
            };
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

    // --- remote input: create TWO DataChannels BEFORE the offer ---
    // host creates both channels so the m=application (SCTP) section is in the
    // first offer (no renegotiation); the client only uses `ondatachannel` (B3).
    // rp-ctl = reliable/ordered (text/keys/clicks); rp-move = unreliable/unordered
    // (mousemove — stale positions are worthless, dropping is correct) (B4).
    let (_input_dcs, input_rx) = configure_input_data_channels(&pc).await?;

    // --- create offer, send to browser ---
    let offer = pc.create_offer(None).await.map_err(SessionError::from)?;
    pc.set_local_description(offer.clone()).await?;
    let offer_msg = serde_json::json!({ "type": "offer", "sdp": offer.sdp }).to_string();
    ws_tx
        .send(Message::Text(offer_msg.into()))
        .await
        .map_err(|e| SessionError::WsHandshake(format!("send offer: {e}")))?;

    let io = SignalingIo {
        ws_tx,
        ws_rx,
        sig_rx,
    };
    let peer = PeerResources {
        pc,
        _input_dcs,
        input_rx: Some(input_rx),
    };
    let session = Session::Negotiating(NegotiatingSession {
        seq,
        token,
        started: Instant::now(),
        io,
        sig_tx,
        peer,
        state_rx,
        au_tx,
        capture_config,
        control,
        cancel,
    });
    let session = match session {
        Session::Negotiating(negotiating) => {
            Session::Connected(negotiating.run_until_connected().await?)
        }
        connected @ Session::Connected(_) => connected,
    };
    match session {
        Session::Connected(connected) => connected.run().await,
        Session::Negotiating(_) => Ok(()),
    }
}

impl NegotiatingSession {
    async fn run_until_connected(mut self) -> Result<ConnectedSession, SessionError> {
        let deadline = tokio::time::sleep(CONNECT_DEADLINE);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = self.cancel.cancelled() => {
                    let _ = self
                        .send_status(RdStatus::Superseded {
                            reason: "remote desktop session was replaced by a newer connection".to_string(),
                        })
                        .await;
                    let _ = self.peer.pc.close().await;
                    return Err(SessionError::Superseded);
                }
                _ = &mut deadline => {
                    let _ = self.peer.pc.close().await;
                    return Err(SessionError::ConnectDeadlineExceeded);
                }
                Some(event) = self.state_rx.recv() => {
                    match event {
                        PeerEvent::Connected => {
                            tracing::info!(
                                "serve-webrtc: session {} connected in {:?}",
                                self.token.redacted(),
                                self.started.elapsed()
                            );
                            return self.into_connected().await;
                        }
                        PeerEvent::Terminal(peer) => {
                            let _ = self
                                .send_status(RdStatus::PeerFailed {
                                    peer,
                                    reason: format!("peer connection {peer} before capture started"),
                                })
                                .await;
                            let _ = self.peer.pc.close().await;
                            return Err(SessionError::PeerFailed(peer.to_string()));
                        }
                    }
                }
                Some(out) = self.io.sig_rx.recv() => {
                    self.send_signaling(out).await?;
                }
                msg = self.io.ws_rx.next() => {
                    let Some(msg) = msg else {
                        let _ = self.peer.pc.close().await;
                        return Err(SessionError::SignalingClosed);
                    };
                    let msg = match msg {
                        Ok(m) => m,
                        Err(e) => {
                            let _ = self.peer.pc.close().await;
                            return Err(SessionError::WsHandshake(e.to_string()));
                        }
                    };
                    if self.apply_ws_message(msg).await? {
                        let _ = self.peer.pc.close().await;
                        return Err(SessionError::SignalingClosed);
                    }
                }
            }
        }
    }

    async fn into_connected(mut self) -> Result<ConnectedSession, SessionError> {
        let mut capture = match CaptureSource::start(
            self.capture_config,
            self.au_tx.clone(),
            self.sig_tx.clone(),
            self.seq,
            self.control.clone(),
        )
        .await
        {
            Ok(capture) => capture,
            Err(e) => {
                if let Some(status) = e.status {
                    if let Err(send_error) = self.send_status(status).await {
                        tracing::warn!(
                            "serve-webrtc: failed to send capture startup failure status: {send_error}"
                        );
                    }
                }
                return Err(e.error);
            }
        };
        if let Some(input_rx) = self.peer.input_rx.take() {
            match capture.capture_display_id_for_input().await {
                Ok(display_id) => {
                    spawn_input_helper(input_rx, self.sig_tx.clone(), display_id);
                }
                Err(reason) => {
                    tracing::warn!("serve-webrtc: {reason}");
                    queue_status(&self.sig_tx, RdStatus::InputFailed { reason });
                }
            }
        }
        Ok(ConnectedSession {
            token: self.token,
            started: self.started,
            io: self.io,
            peer: self.peer,
            state_rx: self.state_rx,
            _capture: capture,
            _caffeinate: CaffeinateGuard::start(),
            cancel: self.cancel,
        })
    }

    async fn send_status(&mut self, status: RdStatus) -> Result<(), SessionError> {
        send_status_ws(&mut self.io.ws_tx, status).await
    }

    async fn send_signaling(&mut self, out: String) -> Result<(), SessionError> {
        self.io
            .ws_tx
            .send(Message::Text(out.into()))
            .await
            .map_err(|e| SessionError::WsHandshake(format!("send signaling: {e}")))
    }

    async fn apply_ws_message(&mut self, msg: Message) -> Result<bool, SessionError> {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => return Ok(true),
            _ => return Ok(false),
        };
        apply_signaling_message(&self.peer.pc, &text).await?;
        Ok(false)
    }
}

impl ConnectedSession {
    async fn run(mut self) -> Result<(), SessionError> {
        let result = self.run_inner().await;
        let _ = self.peer.pc.close().await;
        tracing::info!(
            "serve-webrtc: session {} closed after {:?}",
            self.token.redacted(),
            self.started.elapsed()
        );
        result
    }

    async fn run_inner(&mut self) -> Result<(), SessionError> {
        loop {
            tokio::select! {
                _ = self.cancel.cancelled() => {
                    let _ = self
                        .send_status(RdStatus::Superseded {
                            reason: "remote desktop session was replaced by a newer connection".to_string(),
                        })
                        .await;
                    return Err(SessionError::Superseded);
                }
                Some(event) = self.state_rx.recv() => {
                    match event {
                        PeerEvent::Connected => {}
                        PeerEvent::Terminal(PeerFailureKind::Closed) => return Ok(()),
                        PeerEvent::Terminal(peer) => {
                            let _ = self
                                .send_status(RdStatus::PeerFailed {
                                    peer,
                                    reason: format!("peer connection {peer}"),
                                })
                                .await;
                            return Err(SessionError::PeerFailed(peer.to_string()));
                        }
                    }
                }
                Some(out) = self.io.sig_rx.recv() => {
                    self.io
                        .ws_tx
                        .send(Message::Text(out.into()))
                        .await
                        .map_err(|e| SessionError::WsHandshake(format!("send signaling: {e}")))?;
                }
                msg = self.io.ws_rx.next() => {
                    let Some(msg) = msg else {
                        return Ok(());
                    };
                    let msg = msg.map_err(|e| SessionError::WsHandshake(e.to_string()))?;
                    match msg {
                        Message::Close(_) => return Ok(()),
                        Message::Text(t) => apply_signaling_message(&self.peer.pc, t.as_ref()).await?,
                        _ => {}
                    }
                }
            }
        }
    }

    async fn send_status(&mut self, status: RdStatus) -> Result<(), SessionError> {
        send_status_ws(&mut self.io.ws_tx, status).await
    }
}

async fn apply_signaling_message(
    pc: &Arc<webrtc::peer_connection::RTCPeerConnection>,
    text: &str,
) -> Result<(), SessionError> {
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("answer") => {
            if let Some(sdp) = v.get("sdp").and_then(|s| s.as_str()) {
                let ans = RTCSessionDescription::answer(sdp.to_owned())?;
                pc.set_remote_description(ans).await?;
            }
        }
        Some("candidate") => {
            if let Some(c) = v.get("candidate").and_then(|s| s.as_str()) {
                let init = RTCIceCandidateInit {
                    candidate: c.to_owned(),
                    sdp_mid: v
                        .get("sdpMid")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_owned()),
                    sdp_mline_index: v
                        .get("sdpMLineIndex")
                        .and_then(|x| x.as_u64())
                        .map(|n| n as u16),
                    ..Default::default()
                };
                let _ = pc.add_ice_candidate(init).await;
            }
        }
        _ => {}
    }
    Ok(())
}

struct CaffeinateGuard {
    child: Option<std::process::Child>,
}

impl CaffeinateGuard {
    fn start() -> Self {
        let child = Command::new("caffeinate").arg("-d").spawn().ok();
        Self { child }
    }
}

impl Drop for CaffeinateGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Per-session capture source: either a spawned `rp-screencap` child (default
/// standalone mode) or an AU-from-stdin reader thread (`RP_AU_STDIN=1`, the
/// in-app capture path). Both feed the same `au_tx`; `stop()` ends the session.
enum CaptureSource {
    Child(CaptureHandle),
    Stdin(StdinReaderHandle),
}
impl CaptureSource {
    async fn start(
        config: CaptureConfig,
        au_tx: mpsc::Sender<Vec<u8>>,
        sig_tx: mpsc::UnboundedSender<String>,
        generation: u64,
        control: ControlClient,
    ) -> Result<Self, CaptureStartError> {
        // RP_AU_STDIN=1: the parent app captures+encodes in-process (using the app's
        // Screen Recording TCC grant) and feeds already-encoded Annex-B AUs to our
        // stdin. We then ONLY do WebRTC transport — no rp-screencap spawn. stdout is
        // the framed JSON control channel back to the app.
        // Default (env unset): spawn rp-screencap exactly as before (standalone/dev).
        let au_stdin_mode = std::env::var("RP_AU_STDIN").as_deref() == Ok("1");
        if au_stdin_mode {
            let handle = spawn_au_stdin_reader(au_tx, sig_tx.clone(), generation, control.clone());
            let start_info = match control.start(generation, config).await {
                Ok(info) => info,
                Err(ControlError::CaptureFailed { kind, reason }) => {
                    let error = ControlError::CaptureFailed {
                        kind,
                        reason: reason.clone(),
                    }
                    .into();
                    return Err(CaptureStartError::capture_failed(kind, reason, error));
                }
                Err(ControlError::Superseded { gen, active_gen }) => {
                    return Err(CaptureStartError::without_status(
                        ControlError::Superseded { gen, active_gen }.into(),
                    ));
                }
                Err(e) => {
                    let reason = e.to_string();
                    return Err(CaptureStartError::capture_failed(
                        CaptureErrorKind::Unknown,
                        reason,
                        e.into(),
                    ));
                }
            };
            Ok(CaptureSource::Stdin(handle.with_start_info(start_info)))
        } else {
            match spawn_screencap(config.fps, config.bitrate, config.scale, au_tx) {
                Ok(handle) => Ok(CaptureSource::Child(handle)),
                Err(reason) => {
                    let error = SessionError::Capture(reason.clone());
                    Err(CaptureStartError::capture_failed(
                        CaptureErrorKind::HelperFailed,
                        reason,
                        error,
                    ))
                }
            }
        }
    }

    async fn capture_display_id_for_input(&mut self) -> Result<Option<u32>, String> {
        match self {
            CaptureSource::Child(_) => Ok(None),
            CaptureSource::Stdin(h) => h.capture_display_id_for_input().await,
        }
    }

    fn stop(&self) {
        match self {
            CaptureSource::Child(h) => h.stop(),
            CaptureSource::Stdin(h) => h.stop(),
        }
    }
}

impl Drop for CaptureSource {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Handle to stop the AU-from-stdin reader. The reader thread exits on EOF/error
/// or when `stop()` flips the shared flag; `stop()` also emits a generation-
/// bearing `stop` control op to the parent so it can stop the matching
/// in-app CaptureEngine session.
struct StdinReaderHandle {
    stopped: Arc<std::sync::atomic::AtomicBool>,
    generation: u64,
    control: ControlClient,
    start_info: Option<StartedInfo>,
}
impl StdinReaderHandle {
    fn with_start_info(mut self, start_info: StartedInfo) -> Self {
        self.start_info = Some(start_info);
        self
    }

    fn stop(&self) {
        if !self.stopped.swap(true, std::sync::atomic::Ordering::SeqCst) {
            self.control.stop_noack(self.generation);
        }
    }

    async fn capture_display_id_for_input(&mut self) -> Result<Option<u32>, String> {
        let Some(info) = self.start_info.take() else {
            return Err("host capture start metadata was already consumed".to_string());
        };
        info.display_id.ok_or_else(|| {
            "host capture did not report a display id; remote input disabled to avoid misaligned injection"
                .to_string()
        }).map(Some)
    }
}

/// Start the AU-from-stdin reader for `RP_AU_STDIN=1` mode. It reads
/// `[4B BE len][Annex-B AU]` frames from stdin and forwards them into `au_tx`
/// with the same bounded drop-delta policy as `spawn_screencap`'s reader thread.
/// When `RP_AU_CONTROL_FD` is present, app control ACK/event frames are read on
/// that separate fd so they cannot queue behind media pipe backpressure; otherwise
/// JSON control frames on stdin remain supported as a fallback. The thread returns
/// on EOF/error or when `stop()` is called.
fn spawn_au_stdin_reader(
    au_tx: mpsc::Sender<Vec<u8>>,
    sig_tx: mpsc::UnboundedSender<String>,
    generation: u64,
    control: ControlClient,
) -> StdinReaderHandle {
    tracing::info!("serve-webrtc: AU-from-stdin mode (in-app capture); requesting capture start");

    let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopped_thread = stopped.clone();
    let control_thread = control.clone();
    let mixed_stdin_control = !spawn_app_control_reader_from_env(sig_tx.clone(), control.clone());
    std::thread::Builder::new()
        .name("au-stdin-reader".into())
        .spawn(move || {
            let mut stdin = std::io::stdin();
            let mut dropped_delta_frames = 0u64;
            loop {
                if stopped_thread.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                let Some(au) = read_len_prefixed_frame(&mut stdin, MAX_AU_FRAME_LEN) else {
                    break;
                };
                if stopped_thread.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                if mixed_stdin_control {
                    if let Some(frame) = app_control_frame(&au) {
                        relay_app_control_frame(frame, &sig_tx, &control_thread);
                        continue;
                    }
                } else if app_control_frame(&au).is_some() {
                    tracing::debug!("serve-webrtc: ignoring unexpected control frame on AU stdin");
                    continue;
                }
                if !forward_au_latest(&au_tx, au, &mut dropped_delta_frames) {
                    break;
                }
            }
        })
        .ok();

    StdinReaderHandle {
        stopped,
        generation,
        control,
        start_info: None,
    }
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

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.stop();
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
            let mut dropped_delta_frames = 0u64;
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
                if !forward_au_latest(&au_tx, au, &mut dropped_delta_frames) {
                    break;
                }
            }
        })
        .map_err(|e| format!("spawn reader thread: {e}"))?;

    Ok(CaptureHandle {
        child: std::sync::Mutex::new(child),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(uri: &str) -> Request {
        Request::builder()
            .uri(uri)
            .body(())
            .expect("test request should build")
    }

    fn token(ch: char) -> String {
        std::iter::repeat(ch).take(SESSION_TOKEN_MIN_LEN).collect()
    }

    #[test]
    fn parse_request_token_requires_exact_expected_token() {
        let expected = SessionToken::parse(&token('a')).expect("expected token should parse");
        let accepted = parse_request_token(&request(&format!("/?token={}", token('a'))), &expected)
            .expect("matching token should be accepted");
        assert_eq!(accepted, expected);

        let mismatch = parse_request_token(&request(&format!("/?token={}", token('b'))), &expected);
        assert!(matches!(mismatch, Err(SessionError::TokenMismatch)));

        let missing = parse_request_token(&request("/"), &expected);
        assert!(matches!(missing, Err(SessionError::MissingToken)));
    }

    #[test]
    fn expected_token_arg_reads_owner_file_form() {
        let raw = token('c');
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("test clock should be after epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("xpair-rd-token-{}-{unique}", std::process::id()));
        std::fs::write(&path, format!("{raw}\n")).expect("test token file should write");
        let resolved = expected_token_from_arg(&format!("@{}", path.display()))
            .expect("token file should resolve");
        let _ = std::fs::remove_file(&path);
        assert_eq!(resolved, SessionToken(raw));
    }

    #[test]
    fn superseded_ack_maps_to_session_superseded() {
        let err: SessionError = ControlError::Superseded {
            gen: 42,
            active_gen: 43,
        }
        .into();
        assert!(matches!(err, SessionError::Superseded));
    }

    #[test]
    fn error_ack_maps_to_capture_failed_with_kind_preserved() {
        let err: SessionError = ControlError::CaptureFailed {
            kind: CaptureErrorKind::StartFailed,
            reason: "missing grant".to_string(),
        }
        .into();
        match err {
            SessionError::Capture(reason) => {
                assert!(reason.contains("StartFailed"));
                assert!(reason.contains("missing grant"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn capture_start_error_carries_status_for_direct_send() {
        let err = CaptureStartError::capture_failed(
            CaptureErrorKind::StartFailed,
            "missing grant".to_string(),
            SessionError::Capture("missing grant".to_string()),
        );
        let status = err
            .status
            .as_ref()
            .expect("capture start failures should carry client status");
        let text = status
            .to_signaling_text()
            .expect("capture failure status should serialize");
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("status should be valid json");
        assert_eq!(value["type"], "status");
        assert_eq!(value["kind"], "capture-failed");
        assert_eq!(value["captureKind"], "start-failed");
        assert_eq!(value["reason"], "missing grant");
        assert!(matches!(err.error, SessionError::Capture(_)));
    }

    #[test]
    fn app_control_stream_relays_capture_error_status() {
        let (sig_tx, mut sig_rx) = mpsc::unbounded_channel();
        let payload =
            br#"{"v":1,"event":"capture-error","gen":42,"kind":"start-failed","reason":"no grant"}"#;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(payload);
        let mut cursor = std::io::Cursor::new(frame);
        let control = ControlClient::stdout();

        read_app_control_stream(&mut cursor, &sig_tx, &control);

        let sent = sig_rx
            .try_recv()
            .expect("capture error event should be queued for signaling");
        let value: serde_json::Value =
            serde_json::from_str(&sent).expect("status should be valid json");
        assert_eq!(value["type"], "status");
        assert_eq!(value["kind"], "capture-failed");
        assert_eq!(value["captureKind"], "start-failed");
        assert_eq!(value["reason"], "no grant");
    }

    #[test]
    fn input_writer_drops_stale_moves_without_dropping_releases() {
        let mut last_applied_seq = 0;

        assert!(should_forward_input_message(
            br#"{"t":"d","seq":10,"rx":0.1,"ry":0.1,"btn":"l"}"#,
            &mut last_applied_seq
        ));
        assert_eq!(last_applied_seq, 10);

        assert!(should_forward_input_message(
            br#"{"t":"m","seq":11,"rx":0.2,"ry":0.2,"btn":"l"}"#,
            &mut last_applied_seq
        ));
        assert_eq!(last_applied_seq, 11);

        assert!(!should_forward_input_message(
            br#"{"t":"m","seq":11,"rx":0.3,"ry":0.3,"btn":"l"}"#,
            &mut last_applied_seq
        ));
        assert_eq!(last_applied_seq, 11);

        assert!(should_forward_input_message(
            br#"{"t":"u","seq":12,"rx":0.4,"ry":0.4,"btn":"l"}"#,
            &mut last_applied_seq
        ));
        assert_eq!(last_applied_seq, 12);

        assert!(!should_forward_input_message(
            br#"{"t":"m","seq":12,"rx":0.5,"ry":0.5,"btn":"l"}"#,
            &mut last_applied_seq
        ));
        assert_eq!(last_applied_seq, 12);

        assert!(should_forward_input_message(
            br#"{"t":"k","seq":11,"code":55,"action":"up","flags":0}"#,
            &mut last_applied_seq
        ));
        assert_eq!(last_applied_seq, 12);
    }
}
