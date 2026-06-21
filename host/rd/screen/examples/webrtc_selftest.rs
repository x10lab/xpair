//! webrtc-rs viability self-test (build with `--features webrtc`).
//!
//! De-risks the v1b transport: confirms the `webrtc` crate compiles into this
//! sidecar and can build an H.264 PeerConnection + offer. Run:
//!   cargo run --example webrtc_selftest --features webrtc
//! PASS = it prints an SDP offer advertising H264.
use std::sync::Arc;

use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::APIBuilder;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut m = MediaEngine::default();
    m.register_default_codecs()?;
    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut m)?;
    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();

    let pc = Arc::new(api.new_peer_connection(RTCConfiguration::default()).await?);

    let track = Arc::new(TrackLocalStaticRTP::new(
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
    pc.add_track(track).await?;

    let offer = pc.create_offer(None).await?;
    let has_h264 = offer.sdp.to_lowercase().contains("h264");
    println!("PeerConnection created, add_track(H264) OK, create_offer OK");
    println!("offer advertises H264: {has_h264}");
    println!("--- first 600 chars of SDP ---");
    println!("{}", &offer.sdp.chars().take(600).collect::<String>());
    pc.close().await?;
    if !has_h264 {
        return Err("offer did not advertise H264".into());
    }
    println!("SELFTEST PASS");
    Ok(())
}
