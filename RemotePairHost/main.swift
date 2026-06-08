// main.swift — RemotePairHost 엔트리.  (top-level 실행문은 이 파일에만 둘 수 있음)
//
// 메뉴바 전용 accessory 앱: Dock 아이콘 없음 + graphic-session 보유(AX 합성입력 게이트 조건).
// 책임은 각 .swift 로 분리: Config / HostManager / ApproveManager / Sessions /
//   Permissions / Updater / SettingsWindow / AppDelegate.

import Cocoa

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // 메뉴바 전용 (graphic-session 보유)
app.run()
