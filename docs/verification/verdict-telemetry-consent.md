## CONTRADICTS

- None.

## UNSPECIFIED

- **Crash report opt-in/opt-out/default/toggle semantics.** Cluster expectations about crash report on/off states, crash toggles, crash opt-out, crash choice persistence, and serving/completion with crash reporting enabled or disabled are not specified. §4 (Q0448, Q0449) explicitly leaves this open: "Whether crash reports are opt-in or opt-out remains undecided. Product analytics should not be silently enabled."

- **Optional consent as a non-blocking completion condition.** Expectations such as `선택 동의는 완료 조건이 아님`, `telemetry 거부가 Host 시작을 막지 않음`, or `crash opt-out으로도 완료 가능` are product decisions not stated in `requirements.md`. §1.12 requires exposing the opt-in decision, but it does not define whether refusal can or cannot block completion.

- **Consent persistence and last-write-wins behavior.** Expectations that telemetry/crash values are saved, only the latest value remains, repeated toggles collapse to the final value, or stored values survive close/relaunch are not specified.

- **Checkbox changes only saving consent and not sending data immediately.** Expectations such as `체크 변경은 동의 저장만 해야 함`, `동의 변경 즉시 데이터 전송 없음`, and `변경 즉시 crash report 전송 없음` are not directly supported. `requirements.md` says telemetry should not be silently enabled, but does not define event timing or send behavior for checkbox changes.

- **Specific screen names, labels, and order.** `Welcome -> Before you start 동의 화면`, `Done 화면`, `Open Xpair` completion button, `Next -> Discover`, summary copy, and the exact placement of consent controls are not specified.

- **Done-screen branch topology.** Expectations that the next action branches into exact sets such as `완료/consent 변경/대기`, `완료/안내 확인`, `완료/client 실행`, `완료/paired 문구 확인`, or crash/telemetry-specific branch labels are not specified.

- **Close/dismiss behavior before completion.** Expectations that closing the onboarding window before completion exits without Host serving, leaves only selected consent values, or resumes with the same decision branches on next launch are not specified.

- **Completion or `Open Xpair` starting Host serving with stored consent.** Expectations that pressing `Open Xpair` or the completion button completes Host onboarding or starts Host serving using stored telemetry/crash values are not specified.

- **Discovery/setup sequencing around consent.** Expectations that consent `Next` leads to Discover, that not pressing `Next` prevents host discovery, or that the flow is `Welcome -> consent -> host discovery/setup` are not specified. §1.4 requires LAN-first discovery generally, but not this order.

- **Telemetry/crash detail settings being inaccessible.** Expectations such as `동의 상세 설정 접근 불가` or `Done 화면은 opt-in 체크만 제공` are not specified. `requirements.md` does not define whether detailed telemetry settings exist.

- **Consent summaries and read-only waiting states.** Expectations that opt-in/opt-out states appear in a Done summary, that the user can remain on the screen while reading, or that state-specific summary text is shown are not specified.

- **`동의 저장 없이 Discover 화면으로 이동`.** The special expectation that no consent is saved when both telemetry and crash report are off is not specified, and crash-report default/state is open under §4.

## BACKED

- **Onboarding must expose a telemetry opt-in decision.** This backs only the general expectation that onboarding has a telemetry opt-in decision point; exact screens, labels, persistence, defaults, and completion behavior remain unspecified above. §1.12 (Q0448): "Host should also be covered by Sentry/PostHog if telemetry is enabled, and onboarding must expose the opt-in decision."

Tally: BACKED=1 UNSPECIFIED=12 CONTRADICTS=0 (distinct 예상 considered: 13)
