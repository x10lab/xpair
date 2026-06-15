# remotepair-ide 모노레포 친화 재구조화 설계 (Goal Step 1)

> ✅ **실행됨** — 현행 구조는 [`docs/monorepo-structure.md`](monorepo-structure.md) 참조. 미해결이던 "remotepair-ext 번들링 경로"는 **미배선 갭**으로 확인(현행 문서 §5).

> **목적:** 사용자가 "수정해" 트리거 시 — `ide/` 진입 *전*에 `remotepair-ide` 내부를 모노레포 친화로 정리 → 그다음 런북(`docs/ide-merge-runbook.md`) 실행.
> **결정적 제약:** `remotepair-ide`는 **VSCodium 포크**다. 스톡 레이아웃(`patches/`·`src/`·`build/`·루트 스크립트)을 옮기면 upstream 동기화(`get_repo.sh`/`update_upstream.sh`, 패치 적용 순서)가 깨진다.
> **결론:** 전면 reshuffle ❌ · **경계 정리 + 자기완결화 ✅** (최소·additive·upstream 무해).

---

## 1. 실측: RemotePair 표면 vs VSCodium 스톡

### RemotePair 고유 (우리가 유지보수 — 통합 대상)
| 항목 | 내용 |
|------|------|
| `remotepair-ext/` (13파일) | 내장 확장. `extension.js`는 **외부/부모 경로 참조 0**(stock node + `vscode`만) → 이미 self-contained에 근접 |
| `patches/zz-remotepair-ide-frontend.patch` (2185L) | vscode `workbench/` 소스 직접 패치 + `remotePairPrune.ts`·`remotePairBrowserActions.ts` 신규 주입 |
| `patches/00-brand-remove-branding.patch` | 브랜딩 |
| `patches/80-ui-disable-onboarding.json` · `81-…patch` | VSCode 기본 온보딩 OFF |
| `product.json` 브랜딩 | nameShort=RemotePair · applicationName=remotepair · darwinBundleIdentifier=`com.x10lab.remotepair-ide` · urlProtocol=remotepair … → `prepare_vscode.sh`가 `jq`로 vscode product.json에 **merge(오버레이)** = 깨끗 |

### VSCodium 스톡 (upstream 동기화 — **불가침**)
`src/`(176 아이콘리소스) · `build/`(48) · `patches/` 스톡 50개 · `docs/`(13 전부 스톡) · 루트 스크립트 30+(`build.sh` `prepare_*` `get_repo` `update_upstream` `release` `version`…) · `stores/` `dev/` `font-size/` `upstream/` `icons/` `.github/`

### 미확인 1건 (실행 전 확인)
`remotepair-ext` 번들링 경로 — **빌드 스크립트에 참조가 없다.** `builtInExtensions`(GH 다운로드) 경유인지, `zz-frontend` 패치 경유인지, 수동 배치인지 확정 필요.

---

## 2. 원칙

1. **스톡 경로 불변** → upstream diff 최소 = 동기화 안전.
2. **RemotePair 표면 명시·경계화** → upstream pull 충돌 범위를 즉시 파악.
3. **`ide/` self-contained** → `shared/` 계약은 빌드타임 **생성물**(`remotepair-ext/generated/`)로만 주입하고 **커밋** → standalone 빌드도 안 깨짐.
4. **RemotePair 코드의 단일 소유 지점** 확립(확장 + 프론트엔드 패치).

---

## 3. 재구조화 액션 (안전·최소·upstream 무해)

| # | 액션 | 내용 | 종류 | 리스크 |
|---|------|------|------|--------|
| A | **RemotePair 표면 매니페스트** | `REMOTEPAIR.md`(또는 `.remotepair-manifest`) — "우리 파일/패치" 목록 고정. upstream pull 시 충돌 범위 즉시 식별 | add | 무 |
| B | **`remotepair-ext` = RemotePair 런타임 단일 홈** | `remotepair-ext/generated/` 신설(`shared/` 계약 주입점, 커밋) + 번들링 경로 명시화 | add/wire | 낮음 |
| C | **RemotePair 패치 추적** | 4개 패치를 매니페스트(A)에 기록. ⚠️ **이름 변경 금지** — `00-brand`(초기)·`80/81`(중간)·`zz-frontend`(최후) 적용 순서 의존. 리네임하면 패치 적용 깨짐 | doc-only | 무 |
| D | **identity 동기화 표식** | `product.json` 브랜딩 ↔ `shared/identity/` 단일 버전 소스 연결 지점 표시 | mark | 무 |
| E | **스톡 불가침** | `src/` `build/` `docs/` 루트 스크립트 · 스톡 patches 그대로 | keep | — |

> 핵심: 실제 "폴더 이동"은 **거의 없다**. VSCodium 포크에서 폴더를 옮기는 건 해롭다. 모노레포 친화의 본질은 *경계 명시 + 자기완결화*다.

---

## 4. 이동/생성 맵

| 현재 | 액션 |
|------|------|
| 모든 VSCodium 스톡 | **keep** (0 이동) |
| `remotepair-ext/` | keep + `generated/` 추가 |
| (신규) `REMOTEPAIR.md` 매니페스트 | **add** |
| RemotePair 패치 4개 | keep (이름 유지), 매니페스트에 기록 |
| `product.json` 브랜딩 | keep, identity SoT 연결 표식 |

---

## 5. 실행 전 확인 1건
- `remotepair-ext` 번들링 경로 확정: `zz-remotepair-ide-frontend.patch` 본문 + `product.json`의 `builtInExtensions`/확장 다운로드 설정 확인.

---

## 6. 트리거(“수정해”) 시 실행 순서
1. `remotepair-ide`에 작업 브랜치 생성 (`feat/monorepo-ready` 등)
2. §3 A~E 적용 (안전·additive)
3. `remotepair-ide` 단독 `build.sh` 통과 확인
4. → 런북 `docs/ide-merge-runbook.md` **Phase 0~2**(unshallow → subtree add `ide/`)로 이어감

---

## 7. 솔직한 메모 (방향 확인용)
사용자가 말한 "폴더구조 재구조화"의 가장 강한 레버(폴더 대이동)는 **VSCodium 포크에선 역효과**(upstream 동기화 파괴)다. 그래서 위 설계는 *경계화·자기완결화* 중심의 최소 변경이다. 만약 더 공격적인 재배치(예: RemotePair 코드를 stock에서 더 떼어내기)를 원하면 upstream 추적 포기 트레이드오프를 동반하므로, 트리거 시 그 강도를 한 번 더 맞춘다.
