# RemotePair × IDE 통합 실행 런북 (Stage 2)

> **전제:** `docs/ide-merge-architecture.md`(Stage 1) 승인됨.
> **역할:** 코드 리팩터는 **사용자가 수행**. 본 런북은 정확한 **순서 · git 메커닉 · 구조 작업 목록 · 검증 체크리스트**를 제공한다(그대로 따라 실행 가능).
> **브랜치:** `feat/integrate-remotepair-ide`
> **불변식:** 어느 단계에서도 (a) 양측 독립 빌드 가능, (b) `ide/`는 self-contained(부모 경로 의존 0).

핵심 경로:
- 코어: `/Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair`
- IDE : `/Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide`

---

## Phase 0 — 사전 점검 (안전망)

```bash
# 0.1 현재 상태 태그 (롤백 지점)
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair
git tag pre-ide-merge

# 0.2 IDE 레포 unshallow — subtree add/pull 안정화에 필수
#     (현재 shallow라 fetch가 'shallow roots' 로 거부됨)
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide
git rev-parse --is-shallow-repository      # true 면 아래 실행
git fetch --unshallow origin
git fetch upstream --no-tags               # VSCodium 이력도 확보(staging용)
git rev-parse --is-shallow-repository      # false 확인
```

- [ ] `pre-ide-merge` 태그 생성
- [ ] `remotepair-ide` unshallow 완료(`is-shallow` = false)

---

## Phase 1 — in-place 리팩터 (머지 *전*, 각 레포에서) ← 사용자 코드 작업

> 목표: 머지 시점에 경계가 이미 깔끔하도록 양쪽을 먼저 정리. **이 Phase 전체가 코드 작업** — 런북은 *무엇을 어디로* 만 규정한다.

### 1A. `remote-pair`: `shared/` SoT 추출

| 새 위치 | SoT 내용 | 추출 출처 | 소비자 참조 변경 |
|---------|----------|-----------|------------------|
| `shared/screen-protocol/` | WS 경로·바인딩(`127.0.0.1:<port>`)·JPEG 프레이밍·입력 이벤트(상대좌표 0..1/키) 상수·타입 | `native/remote-pair-screen/src/serve.rs` 주석 프로토콜 | 사이드카(serve.rs)가 상수 참조 / 입력 역전송 포맷 단일화 |
| `shared/onboarding/` | role-aware 스텝 모델(host 8 / client 6 스텝의 id·순서·조건) | `client/web/app.js` `buildSteps(role)` | `client/web`는 모델을 읽어 렌더만 |
| `shared/identity/` | 브랜드명 + **단일 버전 소스** | `Casks/remote-pair-host.rb`(0.4.12) ↔ `product.json`(0.1.0) | Casks·README·product.json이 이 소스 참조 |

- [ ] `shared/screen-protocol/` 추출 + 사이드카가 참조하도록 변경
- [ ] `shared/onboarding/` 스텝 모델 추출 + `client/web` 렌더 분리
- [ ] `shared/identity/` 단일 버전/브랜드 소스 + 소비자 연결
- [ ] `remote-pair` 단독 빌드/테스트 통과

### 1B. `remotepair-ide`: `remotepair-ext` self-contained화

> 원칙: ext는 `shared/`를 **직접 import 하지 않는다**. 대신 `shared/`에서 **생성된 계약 파일**을 소비한다. 그리고 그 **생성물을 `remotepair-ext`에 커밋**해 둔다 → standalone 레포만으로도 빌드 가능(self-contained).

- 생성 스텝(모노레포에서 실행) 개념:
  ```
  shared/{screen-protocol,onboarding,identity}  ──generate──▶  ide/remotepair-ext/generated/*
                                                  (커밋됨 → subtree로 함께 이동)
  ```
- 빌드 훅: `build.sh`/`prepare_vscode.sh` 직전에 `generate-contracts` 단계 추가(모노레포 컨텍스트에서만 갱신, 출력은 커밋).
- [ ] `remotepair-ext`가 `generated/` 계약만 소비하도록 정리(외부 경로 참조 0)
- [ ] 생성 스텝(모노레포 전용) 작성 + 출력 커밋
- [ ] `remotepair-ide` 단독 빌드(`build.sh`) 통과

---

## Phase 2 — subtree 머지 (코어 레포에서)

```bash
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair

# 2.1 IDE 레포를 remote로 (이미 있으면 재사용). unshallow 후엔 fetch 성공.
git remote add ide /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide 2>/dev/null || true
git fetch ide

# 2.2 ide/ 로 서브트리 진입 (추적 415파일만 — vscode/ 등은 ide/.gitignore가 무시)
git subtree add --prefix=ide ide master

# 2.3 확인: 6.9G 산출물이 안 들어왔는지
du -sh .git                          # 수 MB 증가만 정상
git ls-files ide | wc -l             # ~415
git check-ignore ide/vscode 2>/dev/null && echo "vscode/ ignored ✓"
```

> **gitignore 메모:** `remotepair-ide/.gitignore`(→ `ide/.gitignore`)가 `/vscode/` `/VSCode-darwin-*/` `*.dmg` `*.vsix` `**/node_modules/` `**/target/`를 **이미** 무시한다(중첩 .gitignore = ide/ 기준 앵커). 루트 `.gitignore` 수정은 원칙적으로 불필요. 안전을 원하면 루트에 `ide/vscode/` 등 명시 추가도 무방.

- [ ] `git subtree add --prefix=ide` 성공
- [ ] `.git` 용량 정상(수 MB 증가), `ide/vscode` 등 미추적 확인
- [ ] 모노레포에서 `generate-contracts` → `ide/` 빌드 통과

---

## Phase 3 — staging 배선 (VSCodium 추적 존속)

`remotepair-ide` 레포는 폐기하지 않고 **VSCodium 업데이트 흡수 staging**으로 유지한다.

```bash
# (미래 VSCodium 갱신 시 워크플로)
# 3.1 staging 레포에서 VSCodium 흡수
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide
./get_repo.sh          # 또는 update_upstream.sh — 핀된 vscode 갱신
git merge upstream/master   # 패치 충돌은 여기서 해소
git push origin master

# 3.2 모노레포로 당겨오기
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair
git subtree pull --prefix=ide ide master
```

- [ ] staging 워크플로 1회 리허설(소규모 변경으로 pull 왕복 검증)
- [ ] 충돌 해소는 staging 레포에서 먼저 → 그다음 subtree pull

---

## Phase 4 — 통합 검증 체크리스트

- [ ] `remote-pair` 코어 빌드/테스트 통과 (`tests/`)
- [ ] `ide/` 빌드(`cd ide && build.sh`)로 RemotePair IDE 산출
- [ ] `shared/` 계약 단일화 확인: 사이드카·웹·host·ext가 **같은 소스** 참조
- [ ] 버전 정합: `shared/identity/`가 Casks·README·product.json을 한 값으로
- [ ] `ide/`가 self-contained: `ide/` 안에서 부모 경로(`../shared`) 참조 0 (`grep -rn "\.\./\.\./shared" ide/ || echo clean`)
- [ ] `git subtree pull` 왕복 정상
- [ ] 6.9G 산출물 미추적 유지

---

## 명령 시퀀스 요약 (복붙용)

```bash
# Phase 0
cd .../remote-pair && git tag pre-ide-merge
cd .../remotepair-ide && git fetch --unshallow origin && git fetch upstream --no-tags

# Phase 1 = 코드 작업 (shared/ 추출 + ext self-contained). 각 레포 단독 빌드 통과까지.

# Phase 2
cd .../remote-pair
git remote add ide .../remotepair-ide 2>/dev/null || true
git fetch ide
git subtree add --prefix=ide ide master
du -sh .git && git ls-files ide | wc -l

# Phase 3 (미래 VSCodium 갱신마다)
# staging에서: get_repo.sh → merge upstream → push
# 모노레포에서: git subtree pull --prefix=ide ide master
```

---

## 미해결 → 진행 중 결정할 것

| 항목 | 결정 시점 |
|------|-----------|
| 버전 정합 정책(0.4.12 통일 vs IDE 독립) | Phase 1A `shared/identity` 설계 시 |
| 온보딩 SoT 범위(스텝모델 어디까지 공유) | Phase 1A `shared/onboarding` 설계 시 |
| 화면 프로토콜 v1a/v1b 확장 형태 | Phase 1A `shared/screen-protocol` 설계 시 |
| `generate-contracts` 훅 위치(build.sh vs 별도) | Phase 1B |

> 코드 리팩터(Phase 1)는 **사용자**가 수행. 각 Phase 완료 시 알려주면 다음 단계(검증·머지 메커닉)를 함께 진행한다.
