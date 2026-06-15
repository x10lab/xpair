# generated/ — DO NOT EDIT

이 디렉터리는 모노레포 `shared/` SoT에서 **생성**된다.

- 생성기: `../generate-contracts.mjs` (모노레포에서 `node` 실행, `../../shared`를 읽음)
- `contracts.json` = screen-protocol + identity 계약 스냅샷 (포트·입력채널·brand·version)

`remotepair-ext`는 이 **커밋된 생성물만** 소비하므로, standalone `remotepair-ide` 빌드가
`../../shared` 없이도 동작한다(**self-contained** — subtree pull 안전).

값을 바꿀 땐 `shared/`를 고치고 `node ide/remotepair-ext/generate-contracts.mjs`로
재생성한 뒤 커밋한다. 동기성은 `shared/check-ide-selfcontained.sh`가 검증한다.
