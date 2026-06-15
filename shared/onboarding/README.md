# shared/onboarding — 온보딩 단계 모델 SoT

RemotePair 온보딩은 **두 UI**로 렌더된다 — 같은 개념을 중복 표현하던 것을 하나의
정규 모델로 묶는다. `check-onboarding.sh`가 두 UI가 모델과 일치하는지 검증한다.

## 두 UI
| UI | 위치 | 성격 |
|----|------|------|
| 웹 마법사 | `client/cli/web/app.js` `buildSteps(role)` | role-aware 멀티스텝(host 8 / client 6) |
| IDE walkthroughs | `ide/remotepair-ext` `contributes.walkthroughs` (`remotepair.setup`) | 클라이언트-인-IDE 4스텝 |

## 정규 개념 ↔ UI 매핑 (`steps.json`)
| 개념 | 역할 | 웹 마법사 step | IDE walkthrough |
|------|------|----------------|-----------------|
| welcome | host·client | welcome | — |
| permissions | host | permissions, regrant | permissions |
| connect | host·client | ssh, client-ssh-setup, host-guide | connect |
| file-access | host·client | maps, syncthing | fileaccess |
| extensions | client | — | extensions |
| verify | host·client | verify | — |

- **웹 마법사**가 풀 role-aware 플로우(host는 permissions/regrant, client는 host-guide).
- **IDE walkthrough**는 클라이언트 관점 4개(connect/fileaccess/permissions-안내/extensions).
- `extensions`는 IDE 전용(웹엔 없음), `welcome`/`verify`는 웹 전용(IDE는 getting-started가 대체).

## 사용
```bash
shared/onboarding/check-onboarding.sh    # 웹 step id + IDE walkthrough 정합 검증
```
스텝을 추가/이름변경할 땐 `steps.json`을 먼저 고치고 두 UI를 맞춘다.

## 향후
실제 단계 콘텐츠(설명·체크조건)까지 이 모델에서 생성하면 두 UI가 진짜 단일 소스가 된다.
지금은 **스텝 골격·역할·매핑**까지가 SoT(콘텐츠 렌더는 각 UI 자체).
