# Verification verdict: engine-gate

Cluster file: `/tmp/m1_clusters/06-engine-gate.txt`

Near-duplicate expected strings were collapsed into semantic expectation groups.

## CONTRADICTS

- Host/SSH/password/host-first success routes into Engine, Engine+permissions+file-access onboarding, or Host permission/engine onboarding. Representative expected strings: `Engine 단계로 이동`, `Engine, 권한, 파일 접근 온보딩으로 이동`, `Host 권한/엔진 온보딩으로 넘김`, `SSH auth, host app guard, engine 단계로 분기`, `Next 활성, Engine 단계 진입 대기`. Evidence: §1.3 (Q0545), "Engine choice (Claude / Codex / OpenCode) should be offered **before** the device-name / host-setup step, so the user picks their agent up front rather than after pairing." Conflict: the cluster repeatedly places the Engine step after host setup, SSH, password, retry, or host-first guard success.

- Permission approval gates reaching Engine. Representative expected strings: `AX와 SR이 모두 granted일 때만 Engine으로 이동함`, `SR을 승인해야 Engine으로 감`, `AX를 승인해야 Engine으로 감`, `필수 권한 gate가 막아 Engine으로 가지 못함`, `권한 부여가 막혀 Engine 단계로 갈 수 없음`. Evidence: §1.3 (Q0545), "Engine choice (Claude / Codex / OpenCode) should be offered **before** the device-name / host-setup step, so the user picks their agent up front rather than after pairing." Conflict: required Host permissions may block Host usability, but the requirement puts Engine choice before host setup, so permission approval cannot be the gate for entering Engine choice.

- Host onboarding is expected to complete engine install/auth checks before Connect/Done. Representative expected strings: `AX, SR, 선택 FDA, 엔진 설치와 인증을 확인한 뒤 Connect 단계로 넘김`, `claude, codex, opencode 중 하나를 설치 및 인증 완료해야 Connect로 감`, `Host onboarding에서 권한과 엔진 설정을 진행함`. Evidence: §1.3 (Q0545), "Engine choice (Claude / Codex / OpenCode) should be offered **before** the device-name / host-setup step, so the user picks their agent up front rather than after pairing." Conflict: the expected Host onboarding sequence moves engine selection/setup into or after Host setup rather than before host setup.

## UNSPECIFIED

- Exact engine readiness state machine: `installed`, `authed`, `ready`, `probe`, `Engine Next 활성`, and `installed와 authed가 모두 true일 때만 Next를 켬`. `requirements.md` requires checking selected tools, but does not define these state names or Next-button rules.

- API key, external login, terminal/browser login, `authed=true`, key resubmission, and re-check authentication UX. `requirements.md` says onboarding should help install/configure required environment variables, but does not specify API-key UI, external login, or browser/terminal auth flows.

- Engine install/reinstall/retry/environment-repair details: install buttons, repeated install action, same-engine retry, environment fix then retry, and installation failure branches. The requirements do not define this retry tree.

- Engine start/restart controls and recovery: `Start engine`, `Restart engine`, retrying engine response, or expecting host restart to recover engine response. The requirements do not specify engine process control UX.

- Progress and waiting states: keeping a spinner/progress indicator while checking engine, starting engine, installing, or waiting for results. No requirement defines these transient UI states.

- Error-screen control sets and ready-false handling: maintaining failure messages, allowing retry/engine change, showing causes, or ending as `engine ready false`. The requirements do not prescribe these exact error affordances.

- Connect/Waiting/Done transitions after Engine readiness, including client-wait and host-ready branches. The requirements do not define these named stages or their routing.

- Project selection, session creation, file-access onboarding, or project-settings checks after Engine/permissions. The requirements contain folder mapping and session requirements, but not this onboarding sequence.

- Exact permission names and optional permission behavior: AX, SR, FDA, row-level Accessibility handling, optional FDA choice, and permission re-check UI. The requirements require resolving required macOS permissions/TCC, but do not enumerate these specific gates in this document.

- SSH reachability, password auth, Host app guard, version compatibility, and retry guards as flow branches. §4 (Q0430, Q0440) says "The six-digit / sign-in / host-install pairing UX is not fully specified."

- Close/cancel/terminate semantics, including whether incomplete engine setup ends onboarding, preserves host info, saves connection state, or terminates as `engine 미설치/미완료/인증 미완료`. The requirements say setup must not be treated as complete, but do not define user-cancel outcomes.

- VSCodium base surfaces or Xpair-out-of-scope surfaces being inaccessible during Engine. The requirements say the Client is VS Code/VSCodium-like and mention Search/Extensions as possible child surfaces, but do not define Engine-step access blocking.

- Unsupported engine or arbitrary path attempts being blocked as `접근 불가`. The requirements name supported engine choices, but do not specify the UX for unsupported engine paths.

- Direct external installation or Host restart followed by XpairHost re-check/probe. The requirements do not specify how externally completed setup work is detected.

- `Previous`/back navigation returning to Engine selection/state. The requirements do not define back navigation for this flow.

- Saved settings or host-info retention while waiting on Engine. The requirements do not specify state retention for this stage.

## BACKED

- Claude, Codex, and OpenCode are supported engine choices, and onboarding should check/install/configure the selected tool. Representative expected strings: `사용자가 Claude Code를 선택함 → ...설치와 인증 상태를 확인`, `사용자가 Codex를 선택함 → ...설치와 인증 상태를 확인`, `사용자가 opencode를 선택함 → ...설치와 인증 상태를 확인`, `Xpair가 지원하는 엔진만 허용함`. Evidence: §1.3 (Q0541), "If the user chooses Claude, Codex, or OpenCode support, onboarding should check for that tool and help install/configure required environment variables." Also §1.3 (Q0545), "Engine choice (Claude / Codex / OpenCode) should be offered **before** the device-name / host-setup step, so the user picks their agent up front rather than after pairing."

- Engine choice itself is a required onboarding step before host setup. Representative expected strings limited to the choice/check concept: `지원 엔진 선택 흐름으로 이동`, `선택 엔진의 설치와 인증 상태 확인으로 이동`, `현재 선택된 엔진의 설치와 인증 결과로 분기`. Evidence: §1.3 (Q0545), "Engine choice (Claude / Codex / OpenCode) should be offered **before** the device-name / host-setup step, so the user picks their agent up front rather than after pairing."

- Host onboarding must exist for permission/TCC setup. Representative expected strings limited to Host permission onboarding: `Host 권한/엔진 온보딩으로 넘김`, `XpairHost 설정 완료 안내 표시`, `권한 부여 안내와 재확인`. Evidence: §1.2 (Q0441, Q0442, Q0443), "Host onboarding must exist. It is responsible for getting the Host through the required permission/TCC flow."

- Unresolved required macOS permissions must prevent the Host from being considered usable or setup-successful. Representative expected strings: `AX와 SR이 없으면 host setup을 중단함`, `권한은 남지만 Engine 설정은 진행하지 않음`, `필수 권한이 부족하므로 Engine 단계로 넘어가지 않음` insofar as they mean setup is not complete. Evidence: §1.5 (Q0443), "Host onboarding must resolve required macOS permissions before the Host is considered usable. If TCC is not resolved, the app should not proceed as though setup succeeded."

- Client onboarding should not close into the IDE until necessary setup is complete. Representative expected strings: `엔진 설정 완료 없이 온보딩 종료`, `온보딩 완료 없이 종료`, `SR과 AX가 모두 있더라도 Engine 설정 전이면 setup을 완료하지 않음` insofar as they mean setup is not marked complete. Evidence: §1.2 (Q0369, Q0402, Q0474), "Client onboarding closes only after the necessary setup is complete, then the IDE opens into the intended working surface."

- Starting XpairHost before any client should not report completion while no client is connected. Representative expected string: `클라이언트가 없으면 대기 안내에 머물고, 클라이언트가 보이면 Done으로 넘어갈 수 있음` insofar as it does not report completion before a client exists. Evidence: §1.5 (Q0543), "Starting XpairHost before any client is acceptable, but with no connected client the Host onboarding is expected to hold at the permission step rather than report completion."

Tally: BACKED=6 UNSPECIFIED=16 CONTRADICTS=3 (distinct 예상 considered: 25)
