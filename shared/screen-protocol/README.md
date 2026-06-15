# shared/screen-protocol — 화면 프로토콜 단일 소스(SoT)

RemotePair Remote Desktop의 **호스트↔IDE 와이어 계약**을 한 곳에서 선언한다.
구현은 두 곳에 나뉘어 있고(rs = 호스트 엔진, ide = 클라이언트 웹뷰), 이 SoT가
둘이 합의해야 하는 상수·포맷을 고정한다. drift는 `check-screen-protocol.sh`가 잡는다.

## 데이터 흐름
```
[host/rd/ 호스트]                          [client/ide/ 클라이언트(웹뷰)]
remote-pair-screen serve  ──JPEG──▶   remote-desktop.js
  ws 127.0.0.1:8889        (binary)   WS→Blob(jpeg)→createImageBitmap→canvas
        ▲ ssh -L 8889 터널
serve-webrtc :8890 (v2)   ──H.264──▶  v2 peer connection (WebRTC)

[입력 업채널은 별도 — WS 아님]
webview {type:click,rx,ry / key,combo}  ──postMessage──▶  extension.js
extension → host InputServer 파일채널: /tmp/remote-pair.input-req|-res
  click\t<x>\t<y> (host 픽셀) · key\t<combo> · shot\t<path>(v0)
```

## 계약 (`constants.json`)
| 영역 | 값 |
|------|-----|
| v1a 프레임 | `ws://127.0.0.1:8889`, binary whole-frame JPEG, `ssh -L` 터널 |
| v2 WebRTC | signaling `127.0.0.1:8890`, H.264/WebRTC |
| v0 폴백 | ssh 스크린샷 폴링, auto에서 ~4s 무프레임 시 전환 |
| 캡처 파라미터 | fps 1–120 · quality 1–100 · scale 0.1–1.0 |
| 입력 채널 | InputServer `/tmp/remote-pair.input-req`/`-res`, `<verb>\t<args>` |
| 입력 verb | `shot` · `click\t<x>\t<y>`(픽셀) · `key\t<combo>`, throttle 120ms |
| 좌표 | webview 상대 0..1 → extension이 픽셀 변환 |
| webview→ext 메시지 | click·key·ready·v1Dimensions·v1Error·v1FirstFrame·v2Error·v2FirstFrame |

## 소비자
| 소비자 | 구현 |
|--------|------|
| `host/rd/remote-pair-screen/src/serve.rs` | v1a WS+JPEG 서버 (port 8889 default) |
| `host/rd/remote-pair-screen/src/serve_webrtc.rs` | v2 WebRTC (signaling 8890) |
| `client/ide/remotepair-ext/extension.js` | 터널·InputServer 전달·포트 상수(SIDECAR/SIGNAL) |
| `client/ide/remotepair-ext/media/remote-desktop.js` | 웹뷰 렌더·입력 캡처·메시지 어휘 |

## 사용
```bash
shared/screen-protocol/check-screen-protocol.sh   # rs↔ide 정합 검증
```
포트·verb·throттл을 바꿀 땐 여기를 먼저 고치고 양쪽 소비자를 맞춘다.

## 향후
build-time codegen으로 이 상수를 rs(Rust const) / ext(JS const)에 **생성 주입**하면
선언-검증을 넘어 진짜 단일 소스가 된다 (G004 IdeSelfContainment에서 다룸).
