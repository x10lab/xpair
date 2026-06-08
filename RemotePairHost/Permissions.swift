// Permissions.swift — Accessibility(AX) + Screen Recording(SR) 권한 상태 점검 + System Settings 열기.
//
// computer-use 2-게이트:  AX(합성입력) = AXIsProcessTrusted(),  SR(스크린샷) = CGPreflightScreenCaptureAccess().
// SIP+non-MDM 이라 토글은 사용자만 — 우리는 상태 표시 + 올바른 설정 창을 열어줄 뿐.

import Cocoa
import ApplicationServices
import CoreGraphics

enum Permissions {
    static func axTrusted() -> Bool { AXIsProcessTrusted() }
    static func srGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    /// 메뉴 상태줄용 한 줄 요약. 예: "권한: 손쉬운사용 ✓  화면기록 ✗"
    static func summary() -> String {
        "권한: 손쉬운사용 \(axTrusted() ? "✓" : "✗")  화면기록 \(srGranted() ? "✓" : "✗")"
    }

    static func allGranted() -> Bool { axTrusted() && srGranted() }

    /// 권한 요청 프롬프트 유도 + 해당 설정창 열기 + 안내.
    static func requestAndOpen() {
        // 시스템 프롬프트 유도(처음이면 다이얼로그, 이미 결정됐으면 no-op).
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        if !srGranted() { CGRequestScreenCaptureAccess() }

        let panes = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        ]
        for u in panes { if let url = URL(string: u) { NSWorkspace.shared.open(url) } }

        let a = NSAlert()
        a.messageText = "권한 부여 (1회)"
        a.informativeText = """
        System Settings → 개인정보 보호 및 보안 에서 \(APP_NAME) 를 켜라:
          • 손쉬운 사용 (Accessibility)  : \(axTrusted() ? "✓ 이미 켜짐" : "OFF — 켜기")
          • 화면 기록 (Screen Recording) : \(srGranted() ? "✓ 이미 켜짐" : "OFF — 켜기")
        목록에 없으면 + 로 ~/Applications/\(APP_NAME).app 추가.
        토글 후 메뉴의 'Restart tmux host' 로 grant 픽업.
        """
        a.addButton(withTitle: "확인")
        bringToFront()
        a.runModal()
    }
}

/// accessory(LSUIElement) 앱이라 모달/창을 전면으로 끌어올리려면 명시 activate 필요.
func bringToFront() {
    NSApp.activate(ignoringOtherApps: true)
}
