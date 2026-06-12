# Future — 추후 피쳐 / 미뤄둔 작업

이번 세션(2026-06-12~13)에서 논의됐지만 뒤로 미룬 항목들. 우선순위 대략순.

## 1. `remote-pair config` — role 전환 + interactive
- 현재 role(host/client/both)은 설치 시 `install.sh --role` 로만 정해지고, 사후 변경 수단이 없다.
- `remote-pair config` 서브커맨드로:
  - role 을 host ↔ client ↔ both 로 전환(재설치/원복을 manifest 기반으로 안전하게).
  - `REMOTE_HOST`, 폴더 매핑 등 주요 설정을 **interactive 메뉴**로 편집(현재는 env 파일 직접 수정).
- 비대화(`--role host` 등)와 대화 모드 둘 다 제공.

## 2. install.sh 에 Releases zip 다운로드 폴백 (brew 의존 제거)
- 지금 `install.sh --role host` 는 로컬에 빌드된 `build/RemotePairHost.app` 이 있어야만 앱을 깐다(없으면 스킵).
  그래서 빌드 툴체인 없는 호스트는 **brew cask** 로만 앱을 받을 수 있다 → "왜 brew 를 따로 치지?" 어색함.
- install.sh 에 "로컬 빌드 없으면 GitHub Releases 의 서명 zip 다운로드 → quarantine 제거 → 설치" 폴백 추가.
- 효과: 툴체인 없는 호스트도 `install.sh --role host` 한 번으로 앱+approve 원샷, brew 는 순수 선택지로.
  같은 서명 zip 이라 TCC grant 유지.

## 3. glue(skill/hook) 자동 업데이트 트리거
- 현재: cask 가 .app 만 자동 업데이트. approve 스킬·훅(=glue)은 `bootstrap`/`install.sh --role host`
  **재실행** 해야 갱신된다(재실행 시 manifest revert→재설치라 갱신은 정확히 됨).
- 앱이 cask 로 자동 업데이트될 때 glue 도 따라오게 하려면 별도 설계 필요:
  - (a) 앱 self-install(Installer.swift)이 버전업 시 glue 까지 refresh — 단 cask-only 호스트엔 repo 가 없어
    스킬/훅 소스가 없다는 문제(번들에 동봉해야 함).
  - (b) cask postflight 에서 bootstrap 호출.
- 결정 필요: glue 소스를 .app 번들에 넣을지(결합도↑) vs repo 재실행 모델 유지(수동 트리거).

## 4. approve 훅 노이즈 튜닝 (필요 시)
- 현재 matcher = `mcp__claude-in-chrome__.*|mcp__computer-use__.*|Bash`, 게이트 = `denied|permission|timed out|timeout`.
- `--dangerously-skip-permissions` 호스트는 승인 막힘이 대부분 hang→timeout 이라 timeout 을 주 신호로 넣음.
- 부작용: approval 과 무관한 Bash timeout(느린 빌드·행 걸린 테스트)에도 리마인더가 뜰 수 있음.
- 너무 시끄러우면: matcher 에서 Bash 제외(chrome/computer-use 만) 하거나, 게이트에 ssh/git/scp 등
  '인증 동반 명령' 조건을 AND 로 추가.

## 5. cask UX — 설치 후 첫 실행 안내/자동화
- cask 는 .app 만 배치하고 **앱을 자동 실행하지 않음** → 사용자가 한 번 열어야 self-install(LaunchAgent·
  tmux-aqua 링크)이 돈다. 현재 caveats 엔 권한 grant 안내만 있고 "한 번 여세요" 가 빠져 있음.
- caveats 에 "설치 후 앱을 한 번 여세요" 추가, 또는 postflight 에서 `open -a` 로 첫 실행 트리거.

## 6. 서명 cert 전환(33849F → 898E32) 마무리
- 캐노니컬 릴리스가 tag→CI(release.yml, repo 시크릿 p12 leaf 898E32)로 바뀜. 과거 수동 m4(33849F)
  서명본으로 깔린 호스트는 designated requirement 가 갈려 **AX/SR 1회 재grant 필요**.
- 앞으로 계속 898E32(CI)로만 나가면 그 다음부턴 grant 유지. 전환기 1회 재grant 를 README/caveats 에 명시.

## 7. doctor 확장 여지
- 이번에 host approve 스킬·훅 존재 + AX/SR grant 를 healthy 판정에 포함시킴.
- 추가 여지: cliclick/ocr-find 등 나머지 헬퍼 존재, 훅이 settings.json 에서 실제 등록됐는지(`claude /hooks`
  수준), tmux-aqua self-contained 여부(otool) 점검.

---
완료된 관련 작업(참고): 세션 0 근본수정(tmux-aqua 번들 누락 HARD-FAIL + 좀비 감지),
0.4.11/0.4.12 재배포, approve 훅 레포화(install/update/uninstall/doctor 일원화, chrome+computer-use+Bash 커버).
