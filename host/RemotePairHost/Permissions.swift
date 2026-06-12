// Permissions.swift — Accessibility(AX) + Screen Recording(SR) + Full Disk Access(FDA) 권한 상태 점검 + System Settings 열기.
//
// computer-use 2-게이트(필수):  AX(합성입력) = AXIsProcessTrusted(),  SR(스크린샷) = CGPreflightScreenCaptureAccess().
// FDA(권장): 헤드리스 호스트에선 macOS TCC 폴더 프롬프트를 원격에서 누를 수 없어 세션이 멈춘다.
//   FDA 를 켜면 그 프롬프트 자체가 사라진다. 대신 모든 세션이 디스크 전체를 조용히 읽을 수 있으니(메일/메시지/브라우저 포함) 트레이드오프를 감수하는 선택.
// SIP+non-MDM 이라 토글은 사용자만 — 우리는 상태 표시 + 올바른 설정 창을 열어줄 뿐.

import Cocoa
import ApplicationServices
import CoreGraphics

enum Permissions {
    static func axTrusted() -> Bool { AXIsProcessTrusted() }
    static func srGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    /// FDA 는 공개 preflight API 가 없다 → FDA 가 있어야만 열 수 있는 TCC 보호 파일(TCC.db)을 실제로 읽어 추정.
    static func fdaGranted() -> Bool {
        let probe = (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/Application Support/com.apple.TCC/TCC.db")
        guard let fh = FileHandle(forReadingAtPath: probe) else { return false }
        defer { try? fh.close() }
        return ((try? fh.read(upToCount: 1)) ?? nil) != nil
    }

    /// 메뉴 상태줄용 한 줄 요약. 예: "권한: 손쉬운사용 ✓  화면기록 ✗  전체디스크 ✗"
    static func summary() -> String {
        "권한: 손쉬운사용 \(axTrusted() ? "✓" : "✗")  화면기록 \(srGranted() ? "✓" : "✗")  전체디스크 \(fdaGranted() ? "✓" : "✗")"
    }

    /// computer-use 의 필수 게이트만 본다(FDA 는 권장이라 게이트에 넣지 않음).
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
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        ]
        for u in panes { if let url = URL(string: u) { NSWorkspace.shared.open(url) } }

        let a = NSAlert()
        a.messageText = "권한 부여 (1회)"
        a.informativeText = """
        System Settings → 개인정보 보호 및 보안 에서 \(APP_NAME) 를 켜라:
          • 손쉬운 사용 (Accessibility)  [필수]  : \(axTrusted() ? "✓ 이미 켜짐" : "OFF — 켜기")
          • 화면 기록 (Screen Recording) [필수]  : \(srGranted() ? "✓ 이미 켜짐" : "OFF — 켜기")
          • 전체 디스크 접근 (Full Disk)  [권장]  : \(fdaGranted() ? "✓ 이미 켜짐" : "OFF — 헤드리스면 켜기")
        목록에 없으면 + 로 /Applications/\(APP_NAME).app 추가.
        전체 디스크 접근은 원격에서 누를 수 없는 폴더 프롬프트를 없애주지만, 모든 세션이 디스크 전체를 읽게 된다(트레이드오프).
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
