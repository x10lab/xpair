# RemotePair × IDE 통합 아키텍처 & 리팩토링 전략

> ✅ **실행됨** — 현행 구조는 [`docs/monorepo-structure.md`](monorepo-structure.md) 참조. 이 문서는 통합 *전* 계획 기록이다(실제는 rs/ 추가·native/ 제거·shared SoT 반영).

> **상태:** Stage 1 — 방향 합의용 **전략 설계문서**. 승인되면 실행 런북(Stage 2)으로 전개.
> **범위:** 폴더/아키텍처 구조 · 결합 구조 · 리팩토링 전략. **코드 구현은 포함하지 않는다**(코드는 직접 작성).
> **도출:** deep-interview 5라운드(ambiguity 100%→~14%). 전체 기록: `.omc/specs/deep-interview-ide-merge.md`.

---

## 0. 한 줄 요약

`remotepair-ide`(VSCodium 포크, v0.1.0, 미완성)를 `remote-pair` **단일 모노레포**로 흡수한다. 단,
- IDE는 `ide/` **서브트리**로 둔다,
- 두 코드베이스가 공유하는 계약을 `shared/` **SoT**로 추출한다(빌드타임에 IDE로 주입),
- **"리팩터 먼저 → 서브트리 머지 → 옛 IDE 레포는 VSCodium 추적 staging으로 존속"** 순서로 간다.

---

## 1. 출발점 (실측 현황)

두 레포는 **바이트 동일 파일 0개** — "파일만 이동한 같은 코드"가 아니라 **상보적인 별개 코드베이스**다.

| | `remote-pair` (제품 코어, v0.4.12) | `remotepair-ide` (IDE, v0.1.0·미완성) |
|---|---|---|
| 정체 | host/client/CLI/web-온보딩 + Rust 화면 사이드카 | **VSCodium 포크**(shallow, upstream=VSCodium/vscodium) |
| 핵심 트리 | `host/` `client/` `native/` `shared/` `tests/` | `remotepair-ext/` `patches/` `product.json` + 빌드스크립트 |
| 화면 | `rs/remote-pair-screen` — v1a(WS+JPEG) 완료, v1b(WebRTC) TODO | `remotepair-ext/media/remote-desktop.js` — 사이드카 WS 소비 웹뷰 |
| 온보딩 | `client/web` 마법사(role-aware 8/6 스텝) | walkthroughs 4종(+ patch로 VSCode 기본 온보딩 OFF) |
| 규모 | `.git` 4.4M | `.git` 12M(shallow) · 작업트리 **6.9G = 전부 gitignore 빌드산출물** |

**통합이 다뤄야 할 4개 이음새(seam):**
1. **화면 프로토콜** — WS+JPEG 프레임(127.0.0.1, `ssh -L` 터널) + 입력 역전송(상대좌표/키). 사이드카가 정의, IDE 웹뷰·웹클라가 소비. → **단일 계약 후보.**
2. **온보딩** — 같은 개념(permissions/connect/file-access)을 웹 마법사와 IDE walkthroughs **두 UI**가 중복 표현.
3. **버전/브랜딩** — 0.4.12(Casks/README) vs 0.1.0(product.json).
4. **런치 글루** — `client/remote-pair-editor`·`remote-pair-desktop`.

---

## 2. 결정 사항 (deep-interview 5라운드)

| # | 질문 | 결정 | 기각 |
|---|------|------|------|
| R1 | 최종 레포 형태 | **단일 모노레포** (IDE=서브트리) | 허브+서브모듈, 동결흡수 |
| R2 | 폴더 레이아웃 | **점진적**: 루트 유지 + `ide/` + `shared/` SoT 강화 | 풀 reorg, 최소 드롭인 |
| R3 | `ide/`↔`shared/` 결합 | **빌드타임 생성/복사** (ide/ self-contained) | 직접 cross-import, 패키지화 |
| R4 | 머지 순서 | **리팩터-먼저 → 머지 → 옛 레포=staging** | 머지-먼저/폐기, 방향반전 |
| R5 | 산출물 | **전략문서 → 승인 → 런북** | 런북 단독, 전략문서 단독 |

**전체 기각 대안:** full root merge(루트 충돌만 유발·dedup 이득 0), git submodule(요청은 "레포에 머지"), 방향반전(IDE를 우산으로), VSCodium 동결흡수(upstream 보안/기능 업데이트 수동화 부담).

---

## 3. 타겟 구조 (#1)

```
remote-pair/                       ← 단일 모노레포 루트 (현 구조 유지)
├─ host/                           RemotePairHost · hooks · approve-router · ocr-find
├─ client/                         CLI 7종 + web/ 온보딩 (렌더러)
│   └─ web/                        ← 온보딩 "렌더" 만 남기고, 스텝 모델은 shared/로
├─ native/
│   └─ remote-pair-screen/         Rust 사이드카 (v1a WS+JPEG · v1b WebRTC)
│       └─ (프로토콜 상수/포맷은 shared/screen-protocol/ 참조)
│
├─ ide/                            ◀ NEW: remotepair-ide 서브트리
│   ├─ remotepair-ext/             확장(self-contained — 생성된 계약 포함)
│   ├─ patches/                    VSCodium 패치 (brand/onboarding/frontend)
│   ├─ product.json  build.sh ...  VSCodium 빌드 래퍼
│   └─ vscode/  VSCode-darwin-*/   ← gitignore (재생성)
│
├─ shared/                         ◀ 강화: 단일 SoT (계약 정의처)
│   ├─ screen-protocol/            WS 경로·JPEG 프레이밍·입력 이벤트(+v1b) 계약
│   ├─ onboarding/                 role-aware 스텝 모델(공통 정의)
│   └─ identity/                   브랜드명 · 단일 버전 소스
│
├─ docs/  tests/  assets/  Casks/  .github/
└─ (context/ = untracked 참조, 그대로)
```

### 현재 → 타겟 매핑

| 현재 위치 | 타겟 | 변화 |
|-----------|------|------|
| `remote-pair/host/` | `host/` | 그대로 |
| `remote-pair/client/` (+`web/`) | `client/` | 온보딩 **스텝 모델**만 `shared/onboarding/`로 추출, 렌더는 잔류 |
| `remote-pair/rs/remote-pair-screen/` | `rs/remote-pair-screen/` | 프로토콜 상수/포맷을 `shared/screen-protocol/`로 추출 |
| `remote-pair/shared/` | `shared/` | + `screen-protocol/` `onboarding/` `identity/` |
| `remotepair-ide/` (추적 415파일) | `ide/` | 서브트리로 진입, `remotepair-ext`는 self-contained화 |
| `remotepair-ide/vscode/` 등 6.9G | `ide/…` (gitignore) | 추적 안 함 |
| 버전(Casks/README ↔ product.json) | `shared/identity/` | 단일 버전 소스로 정합 |

---

## 4. 결합 구조 (#2)

핵심 원칙: **`shared/`가 계약의 SoT. `ide/`는 self-contained.** IDE는 `shared/`를 런타임에 직접 import하지 않고, **빌드 prepare 단계에서 필요한 계약을 `remotepair-ext`로 생성/복사**해 넣는다.

```
            shared/screen-protocol/      shared/onboarding/      shared/identity/
                  │  (SoT: .ts/.json 계약·상수·스텝모델·버전)
        ┌─────────┼───────────────────────────┬───────────────────────┐
        │ 직접참조 │ 직접참조                    │ prepare 빌드: generate/copy
        ▼         ▼                            ▼                       ▼
   native/      client/web/                host/                 ide/remotepair-ext/
 remote-pair-   (온보딩 렌더)              (식별·버전)            (생성된 계약 포함 = self-contained)
   screen                                                              │
                                                          subtree pull ▼ ← VSCodium-IDE repo
                                                          충돌 없음(ext는 생성물만 보유)
```

- **사이드카·웹·host** = 같은 레포 모듈이므로 `shared/`를 직접 참조해도 무방.
- **`ide/remotepair-ext`** = VSCodium를 따라가는 서브트리 안 → **직접 참조 금지.** prepare 빌드가 계약을 주입. 덕분에:
  - `git subtree pull`(VSCodium 갱신 반영) 시 `shared/` 경로 충돌이 없다,
  - standalone `remotepair-ide` 레포만으로도 빌드가 깨지지 않는다.
- **경계 규칙(불변식):** `ide/` 트리는 부모 레포 경로(`../shared` 등)에 대한 빌드/런타임 의존이 없어야 한다. 의존은 오직 "생성된 산출물"로만.

---

## 5. 리팩토링 전략 (#3)

**순서가 핵심이다 — 리팩터가 머지보다 먼저.** (self-contained화는 머지 후에 하면 무거운 트리 위에서 경계가 더럽혀진다.)

```
[1] 양 레포 in-place 리팩터 (각자 레포에서)
    ├─ remotepair-ide:  remotepair-ext를 self-contained로
    │                   (계약을 외부참조→생성물 소비 구조로 정리)
    └─ remote-pair:     shared/{screen-protocol,onboarding,identity} 추출
                        (사이드카·웹·host가 shared/ 참조하도록)
                 │
[2] subtree 머지  ▼
    remote-pair에서:  git subtree add --prefix=ide <remotepair-ide> <ref>
    → remote-pair/ide/ 로 진입  (vscode/ 등은 gitignore)
                 │
[3] staging 존속  ▼
    remotepair-ide 레포 = VSCodium 추적 staging 으로 유지
    ├─ 미래 VSCodium 업데이트는 여기서 먼저 흡수(get_repo.sh/update_upstream.sh),
    └─ remote-pair는 git subtree pull --prefix=ide 로 당겨옴
```

### 이동/통합/추출 분류

| 동작 | 대상 |
|------|------|
| **이동(move)** | remotepair-ide 추적 트리 → `ide/` (서브트리) |
| **추출(extract)** | 화면 프로토콜 상수·온보딩 스텝모델·버전 → `shared/` |
| **통합(unify)** | 버전 단일화(0.4.12/0.1.0 정책), 브랜드 식별 → `shared/identity/` |
| **유지(keep)** | host/·CLI·사이드카 코어 로직, VSCodium 빌드 래퍼 |
| **무시(ignore)** | `ide/vscode/` `ide/VSCode-darwin-*/` `*.dmg` `node_modules` |

### git 메커닉 & 주의사항(caveat)

- **shallow clone:** `remotepair-ide`는 현재 shallow다(앞서 `git fetch`가 `shallow roots…`로 거부됨). staging으로 존속시키려면 **`git fetch --unshallow`**(VSCodium 전체 이력 다운로드)가 선행돼야 subtree add/pull이 안정적이다.
- **subtree pull 충돌:** VSCodium 갱신이 `patches/`·`remotepair-ext` 변경과 만나면 충돌 가능 → staging 레포에서 먼저 해소 후 pull.
- **gitignore:** 머지 전에 remote-pair `.gitignore`에 `ide/vscode/`, `ide/VSCode-darwin-*/`, `ide/**/node_modules/`, `ide/*.dmg` 추가.
- **전이 중 빌드 유지:** [1]·[2] 사이 어느 시점에도 양측이 독립 빌드 가능해야 한다(self-contained 원칙이 이를 보장).

---

## 6. 리스크 & 런북 단계에서 결정할 것

| 항목 | 메모 |
|------|------|
| shallow → unshallow | VSCodium 전체 이력 용량/시간 확인 필요 |
| 버전 정합 정책 | 0.4.12 기준 통일? IDE 독립 버전? — 런북에서 확정 |
| 온보딩 SoT 범위 | 본 단계는 "스텝 모델 공유 **구조**"까지. 실제 마법사↔walkthrough 렌더 구현은 코드 작업(사용자) |
| 화면 프로토콜 v1b | WebRTC는 양측 future — 계약을 v1a/v1b 확장 가능하게 설계 |
| 정확한 파일이동 맵 | 런북에서 파일 단위로 |

---

## 7. 다음 단계

1. **이 문서(전략) 승인** ← 현재 게이트
2. 승인 시 → **실행 런북(Stage 2)**: 파일 이동 맵 · `git`/셸 명령 시퀀스 · `.gitignore` diff · prepare-빌드 생성 스텝 · 단계별 체크리스트 (그대로 따라 실행 가능)
3. 코드 리팩터·머지 실행은 **사용자**가 수행. 완료 시 알려주면 다음 단계 지원.
