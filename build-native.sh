#!/bin/bash
# build-native.sh — 네이티브 Swift AutoApprove.app 빌드 (approve + computer-use host 통합)
#
# 기존 osacompile applet 대체. 한 앱이 두 역할:
#  - approve: engine.applescript(~/.claude/auto-approve/) 를 NSAppleScript 로 in-process 실행(클릭)
#  - host:    patched tmux-aqua 서버를 자식으로 붙들어 그 안 claude 가 AX·SR 상속 → computer-use
#  - NSStatusItem(메뉴바) = graphic-session 확보 (AX 합성입력 게이트 조건)
#
# Swift 툴체인 필요 (M4 Xcode). bundle id=com.ghyeong.auto-approve, 실행파일명=applet
# (기존 LaunchAgent com.ghyeong.auto-approve.plist 가 .../MacOS/applet 을 그대로 실행).
#
# 주의: ad-hoc 서명이라 재빌드 시 cdhash 변경 → 손쉬운사용/화면기록 1회 재토글 필요
#   (tccutil reset Accessibility com.ghyeong.auto-approve; ...ScreenCapture; 후 재토글).
# 사용: ./build-native.sh [--deploy]   (--deploy 면 M1 ~/Applications 로 설치)
set -euo pipefail
cd "$(dirname "$0")"

SRC=AutoApproveNative/main.swift
OUT=AutoApproveNative/AutoApprove
APP=build/AutoApprove.app

echo "=== compile (Swift) ==="
xcrun swiftc -O "$SRC" -o "$OUT"

echo "=== bundle ==="
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS"
cp "$OUT" "$APP/Contents/MacOS/applet"     # LaunchAgent 가 applet 실행
cat > "$APP/Contents/Info.plist" <<'P'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>AutoApprove</string>
<key>CFBundleDisplayName</key><string>AutoApprove</string>
<key>CFBundleIdentifier</key><string>com.ghyeong.auto-approve</string>
<key>CFBundleExecutable</key><string>applet</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>2.0</string>
<key>CFBundleShortVersionString</key><string>2.0</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
P
codesign -s - --force --deep "$APP"
echo "built: $APP ($(file "$APP/Contents/MacOS/applet" | cut -d: -f2))"

if [ "${1:-}" = "--deploy" ]; then
  echo "=== deploy → M1 ~/Applications ==="
  scp -q -r "$APP" gh-mac-m1:/tmp/AutoApprove-deploy.app
  ssh gh-mac-m1 'launchctl bootout gui/$(id -u)/com.ghyeong.auto-approve 2>/dev/null; pkill -f "AutoApprove.app/Contents/MacOS/applet" 2>/dev/null; sleep 1;
    rm -rf ~/Applications/AutoApprove.app && cp -R /tmp/AutoApprove-deploy.app ~/Applications/AutoApprove.app && rm -rf /tmp/AutoApprove-deploy.app;
    codesign -s - --force --deep ~/Applications/AutoApprove.app;
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ghyeong.auto-approve.plist 2>/dev/null || launchctl kickstart -k gui/$(id -u)/com.ghyeong.auto-approve;
    echo "deployed + (re)started"'
  echo "※ cdhash 바뀌었으면 M1 설정에서 AutoApprove 손쉬운사용·화면기록 재토글 필요"
fi
