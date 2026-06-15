# shared/identity — 브랜드·버전 단일 소스(SoT)

RemotePair 모노레포(`remote-pair` 코어 · `client/ide/` VSCodium 포크 · `host/rd/` 네이티브 엔진)의
**브랜드 식별자와 버전을 한 곳에서 선언**한다. 소비자가 이종(Ruby·JSON·Swift·Cargo)이라
값을 직접 주입하는 대신 **선언 + 정합 체크**로 단일성을 강제한다.

## 파일
| 파일 | 역할 |
|------|------|
| `identity.json` | 제품명·org·urlProtocol·서명 CN + 컴포넌트별 식별자(bundleId, applicationName 등) |
| `versions.json` | 컴포넌트별 버전 레지스트리 (host/ide/screen-engine — **독립 버전**, 강제 동일화 안 함) |
| `check-identity.sh` | 소비자가 SoT와 일치하는지 검증, drift면 비0 종료 |

## 소비자 매핑
| 소비자 | 검증 항목 |
|--------|-----------|
| `client/ide/product.json` | nameShort/Long·applicationName·dataFolderName·darwinBundleIdentifier·urlProtocol·server*·win32* |
| `client/ide/remotepair-ext/package.json` | `version` == `versions.ide` (product.json엔 version 없음 — 앱 버전은 빌드시 RELEASE_VERSION 주입) |
| `Casks/remote-pair-host.rb` | `version` == `versions.host` |
| `host/rd/remote-pair-screen/Cargo.toml` | `version` == `versions.screen-engine` |
| `host/app/Config.swift` | `BUNDLE_ID` 기본값에 `components.host.bundleId` 존재 |

## 사용
```bash
shared/identity/check-identity.sh      # 정합 검증 (CI/릴리스 전)
```

값을 바꿀 땐 **여기(identity.json/versions.json)를 먼저 고치고** 소비자를 맞춘 뒤 체크를 통과시킨다.

## 버전 정책
컴포넌트는 성숙도가 달라 독립적으로 버전이 오른다(host 0.4.x = 성숙, client/ide/rs 0.1.0 = 초기).
`versions.json`은 "현재 버전을 한 곳에서 읽는" 지점일 뿐, 동일 버전을 강제하지 않는다.

## 향후
`docs/ide-merge-architecture.md`의 build-time codegen 방향대로, prepare 단계가 이 SoT에서
소비자 값을 **생성/주입**하도록 확장 가능(특히 `client/ide/` self-containment 시 — 별도 스토리).
