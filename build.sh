#!/bin/bash
# build.sh — Build ~/Applications/AutoApprove.app from loader.applescript.  ★ 한 번만 빌드.
#
# loader 는 런타임에 ~/.claude/auto-approve/engine.applescript 를 자동 감지해 실행하므로,
# 로직/규칙을 고칠 땐 재빌드 불필요 — engine.applescript / rules.applescript 만 수정하면 됨.
#
# ad-hoc 서명(codesign -s -)이라 재빌드하면 서명 정체성이 흔들려 Accessibility 권한이
# 무효화될 수 있다. 그래서 "한 번만 빌드 → 권한 한 번 부여" 가 이 구조의 핵심이다.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/loader.applescript"
APP="$HOME/Applications/AutoApprove.app"
PLIST="$APP/Contents/Info.plist"

mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -o "$APP" "$SRC"

# Dock 에서 숨김 + 안정적 bundle id (TCC 권한이 귀속될 정체성)
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.ghyeong.auto-approve" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.ghyeong.auto-approve" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleName string AutoApprove" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSBackgroundOnly bool false" "$PLIST" 2>/dev/null || true

# ad-hoc 서명 — TCC 가 권한을 귀속시킬 안정적 정체성
codesign --force --deep -s - "$APP"

echo "built: $APP"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST"
echo
echo "다음 (이 머신에서 한 번만):"
echo "  1) 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용(Accessibility) 에 AutoApprove 추가/허용"
echo "  2) LaunchAgent 등록 (com.ghyeong.auto-approve / -watchdog)"
echo "  이후 engine.applescript / rules.applescript 수정은 재빌드 불필요."
