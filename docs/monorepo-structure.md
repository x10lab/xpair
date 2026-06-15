# RemotePair 모노레포 구조 (현행)

> **이 문서가 현행 구조의 단일 진실(SoT)이다.** `docs/ide-merge-*.md`는 통합 *전* 계획이며,
> 본 문서는 실제 실행 결과를 반영한다.
> 브랜치: `refactor/monorepo` · 대상: `remote-pair`(코어) · `remotepair-ide`(IDE) · `remotepair-rs`(엔진).
> **제외:** `-ide2`(RustDesk 임베드 트랙 — 별개, 병렬 진행).

## 1. 구성 — 3 형제 레포 → 단일 모노레포

```
remote-pair/                  (단일 git 모노레포 — host/client × 컴포넌트)
├─ host/                      ◀ 호스트 머신에서 실행
│   ├─ app/                   RemotePairHost.app 소스 (메뉴바·캡처·입력·grant 소유)
│   ├─ rd/                    ◀ 원격데스크톱 엔진 서브트리 (remotepair-rs)
│   │   ├─ remote-pair-screen/  Rust: serve.rs(WS+JPEG)·serve_webrtc.rs(WebRTC)
│   │   └─ rpmedia/             Swift: 캡처·VT인코드·입력주입(AX)
│   ├─ hooks/  skills/        claude 호스트 연동
│   └─ build-host·approve-router·rules·ocr-find   빌드/데몬 글루
├─ client/                    ◀ 클라이언트 머신에서 실행
│   ├─ cli/                   remote-pair* CLI + web/ 온보딩(role-aware) + hangul-romanize
│   └─ ide/                   ◀ remotepair-ide 서브트리 (VSCodium 포크) — 내장 ext + generated/
├─ shared/                    ◀ SoT (아래 §2)
├─ docs/  tests/  assets/  Casks/
```
> 역할×위치 재배치: `rs`("rust"라 의미불명) → **`host/rd`**(remote-desktop=화면+입력, 호스트측), `ide` → **`client/ide`**, `client/*` → **`client/cli`**, `host/RemotePairHost` → **`host/app`**.
> 구 `native/`(화면엔진 사본)는 제거 — `host/rd`로 통일. 검증: swiftc(host/app) + 전체 tests + SoT 체크 green.
> `client/ide/vscode/`·`*.dmg` 등 6.9G 빌드산출물은 중첩 `.gitignore`가 자동 무시.

## 2. shared/ — 단일 소스(SoT)

| 디렉터리 | 계약 | 소비자 | 체크 |
|----------|------|--------|------|
| `shared/identity/` | 브랜드·컴포넌트 식별자·버전(독립) | Casks·client/ide/product.json·host/rd Cargo·host/app Config | `check-identity.sh` |
| `shared/screen-protocol/` | WS/WebRTC 포트·프레임·입력채널·메시지 어휘 | host/rd(serve*.rs)·client/ide(extension·remote-desktop.js) | `check-screen-protocol.sh` |
| `shared/onboarding/` | role-aware 단계모델 | 웹 마법사·IDE walkthroughs | `check-onboarding.sh` |

**build-time codegen:** `client/ide/remotepair-ext/generate-contracts.mjs`가 `shared/`를 읽어
`client/ide/remotepair-ext/generated/contracts.json`을 생성(커밋). `remotepair-ext`는 이 생성물만
소비 → **ide/ self-contained**(standalone 빌드가 `../../shared` 불필요, subtree pull 안전).
검증: `shared/check-ide-selfcontained.sh`.

## 3. 실행된 리팩터

| 단계 | 내용 |
|------|------|
| 조립 | `git subtree add` → `ide/`(unshallow 후)·`rs/`; native/ 제거 |
| G001 identity SoT | `shared/identity/` + 정합 체크(14 consumers) |
| G002 screen-protocol SoT | `shared/screen-protocol/` + 체크(rs↔ide 19항목) |
| G003 onboarding SoT | `shared/onboarding/` + 체크(웹+IDE 18항목) |
| G004 ide self-containment | generate-contracts.mjs + generated/ + extension.js 배선 |

## 4. 전체 검증
```bash
shared/identity/check-identity.sh
shared/screen-protocol/check-screen-protocol.sh
shared/onboarding/check-onboarding.sh
shared/check-ide-selfcontained.sh
```

## 5. 알려진 갭 (IDE 미완성 / 후속)
- **remotepair-ext 번들링 미배선**: `build.sh`/`product.json` builtInExtensions에 안 묶임(현재 `.vsix`만).
  IDE 완성 시 prepare 단계에 generate-contracts + ext 번들 등록 필요.
- **rs/ self-containment 미적용**: rs는 아직 shared 직접 미참조(리터럴 유지, 체크로 정합만). 향후 Rust codegen 가능.
- **버전 정합 정책**: 컴포넌트 독립 버전 유지(host 0.4.12 / ide·rs 0.1.0) — 통일 강제 안 함.

## 6. upstream 동기화
`ide/`는 VSCodium 포크. standalone `remotepair-ide` 레포 = VSCodium 추적 **staging**으로 존속,
거기서 `update_upstream.sh`/`get_repo.sh`로 흡수 후 모노레포는 `git subtree pull --prefix=ide`.
