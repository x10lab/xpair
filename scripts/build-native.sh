#!/bin/bash
# build-native.sh — 네이티브 Swift RemotePair.app 빌드 (approve + computer-use host 통합)
#
# 한 앱이 두 역할:
#  - approve: engine.applescript(~/.claude/auto-approve/) 를 NSAppleScript 로 in-process 실행(클릭)
#  - host:    patched tmux-aqua 서버를 자식으로 붙들어 그 안 claude 가 AX·SR 상속 → computer-use
#  - NSStatusItem(메뉴바) = graphic-session 확보 (AX 합성입력 게이트 조건)
#
# Swift 툴체인 필요 (M4 Xcode). bundle id=com.ghyeong.remote-pair, 실행파일명=RemotePair
#
# 서명: 안정 self-signed cert "RemotePair Local Signing" 로 서명 (M4 keychain 에 존재).
#   → TCC grant 가 cdhash 가 아니라 designated requirement(서명 정체성)에 묶여 재빌드에도 grant 유지.
#   cert 없으면 ad-hoc 폴백(재빌드마다 재토글 필요). cert 생성:  ./make-signing-cert.sh
#
# 사용: ./build-native.sh [--deploy]   (--deploy 면 M1 으로 마이그레이션 설치)
set -euo pipefail
cd "$(dirname "$0")/.."   # repo 루트 (scripts/ 의 부모) — RemotePairNative/·build/ 가 여기 기준

SRC=RemotePairNative/main.swift
OUT=RemotePairNative/RemotePair
APP=build/RemotePair.app
BUNDLE=com.ghyeong.remote-pair
EXEC=RemotePair
SIGN_CN="RemotePair Local Signing"
REMOTE=gh-mac-m1

# 서명 정체성 결정 (안정 cert 있으면 그걸로, 없으면 ad-hoc)
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_CN"; then
  SIGN_ID="$SIGN_CN"; echo "서명: 안정 cert '$SIGN_CN' (재빌드에도 grant 유지)"
else
  SIGN_ID="-"; echo "⚠ 서명: ad-hoc (cert '$SIGN_CN' 없음 → 재빌드마다 재토글 필요). ./make-signing-cert.sh 로 생성 권장"
fi

echo "=== compile (Swift) ==="
xcrun swiftc -O "$SRC" -o "$OUT"

echo "=== bundle ==="
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS"
cp "$OUT" "$APP/Contents/MacOS/$EXEC"
cat > "$APP/Contents/Info.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>RemotePair</string>
<key>CFBundleDisplayName</key><string>RemotePair</string>
<key>CFBundleIdentifier</key><string>${BUNDLE}</string>
<key>CFBundleExecutable</key><string>${EXEC}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>3.0</string>
<key>CFBundleShortVersionString</key><string>3.0</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
P
codesign -s "$SIGN_ID" --force "$APP"
echo "built + signed: $APP"
codesign -dv "$APP" 2>&1 | grep -iE 'Authority|^Identifier|TeamId' || true
codesign --verify --strict "$APP" && echo "verify OK ✓"

if [ "${1:-}" = "--deploy" ]; then
  echo ""
  echo "=== deploy → ${REMOTE} (마이그레이션: 구 AutoApprove 제거 → RemotePair) ==="
  echo "[현재 host 세션 (컷오버 시 끊김 주의)]"
  ssh "$REMOTE" '~/.local/bin/tmux-aqua -S /tmp/aqua-tmux.sock ls 2>/dev/null || echo "(서버 없음)"'

  # 서명된 앱 + /approve 스킬 전송 (M1 에서 재서명 금지 — M4 cert 서명을 그대로 보존)
  scp -q -r "$APP" "${REMOTE}:/tmp/RemotePair-deploy.app"
  scp -q -r skills "${REMOTE}:/tmp/RemotePair-skills"

  ssh "$REMOTE" 'set -e
    U=$(id -u)
    # 1) 구 AutoApprove + (재배포 시) 기존 RemotePair bootout/제거
    launchctl bootout gui/$U/com.ghyeong.auto-approve 2>/dev/null || true
    launchctl bootout gui/$U/com.ghyeong.auto-approve-watchdog 2>/dev/null || true
    launchctl bootout gui/$U/com.ghyeong.remote-pair 2>/dev/null || true
    launchctl bootout gui/$U/com.ghyeong.remote-pair-watchdog 2>/dev/null || true
    pkill -f "AutoApprove.app/Contents/MacOS" 2>/dev/null || true
    pkill -f "RemotePair.app/Contents/MacOS" 2>/dev/null || true
    sleep 1
    rm -rf ~/Applications/AutoApprove.app
    rm -f ~/Library/LaunchAgents/com.ghyeong.auto-approve.plist
    rm -f ~/Library/LaunchAgents/com.ghyeong.auto-approve-watchdog.plist
    # 구 bundle id 의 stale grant 정리(있어도 무해, 새 grant 는 새 bundle id)
    tccutil reset Accessibility com.ghyeong.auto-approve 2>/dev/null || true
    tccutil reset ScreenCapture com.ghyeong.auto-approve 2>/dev/null || true

    # 2) RemotePair.app 설치 (재서명 안 함, quarantine 제거)
    rm -rf ~/Applications/RemotePair.app
    cp -R /tmp/RemotePair-deploy.app ~/Applications/RemotePair.app
    rm -rf /tmp/RemotePair-deploy.app
    xattr -dr com.apple.quarantine ~/Applications/RemotePair.app 2>/dev/null || true
    codesign --verify --strict ~/Applications/RemotePair.app && echo "  서명 검증 OK ✓ (M4 cert 보존)"

    # 2b) /approve 스킬 설치 (claude 가 RemotePair 에 클릭 요청하는 인터페이스)
    mkdir -p ~/.claude/skills
    rm -rf ~/.claude/skills/approve
    cp -R /tmp/RemotePair-skills/approve ~/.claude/skills/approve
    rm -rf /tmp/RemotePair-skills
    echo "  skill 설치: ~/.claude/skills/approve"

    # 3) watchdog 스크립트 (heartbeat=remote-pair.heartbeat, label=com.ghyeong.remote-pair)
    cat > ~/.claude/bin/remote-pair-watchdog.sh <<'"'"'W'"'"'
#!/bin/bash
# remote-pair-watchdog.sh — RemotePair.app heartbeat 가 멈추면 재기동.
# approve tick 이 hung AX 호출로 wedge 될 수 있어, heartbeat 정지 시 kickstart.
set -u
HB="$HOME/.claude/logs/remote-pair.heartbeat"
LOG="$HOME/.claude/logs/remote-pair.log"
STALE=90
LABEL="gui/$(id -u)/com.ghyeong.remote-pair"
now=$(date +%s)
if [ -f "$HB" ]; then
  mtime=$(stat -f %m "$HB" 2>/dev/null || echo 0)
  age=$(( now - mtime ))
  if [ "$age" -gt "$STALE" ]; then
    launchctl kickstart -k "$LABEL" >/dev/null 2>&1
    printf "%s watchdog: heartbeat stale %ss -> kickstart\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$age" >> "$LOG"
  fi
else
  launchctl kickstart -k "$LABEL" >/dev/null 2>&1
fi
W
    chmod +x ~/.claude/bin/remote-pair-watchdog.sh

    # 4) LaunchAgent plists 작성
    cat > ~/Library/LaunchAgents/com.ghyeong.remote-pair.plist <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ghyeong.remote-pair</string>
  <key>ProgramArguments</key><array><string>'"$HOME"'/Applications/RemotePair.app/Contents/MacOS/RemotePair</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>'"$HOME"'/.claude/logs/remote-pair.out.log</string>
  <key>StandardErrorPath</key><string>'"$HOME"'/.claude/logs/remote-pair.err.log</string>
</dict></plist>
P
    cat > ~/Library/LaunchAgents/com.ghyeong.remote-pair-watchdog.plist <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ghyeong.remote-pair-watchdog</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>'"$HOME"'/.claude/bin/remote-pair-watchdog.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>'"$HOME"'/.claude/logs/remote-pair-watchdog.err.log</string>
</dict></plist>
P

    # 5) bootstrap
    launchctl bootstrap gui/$U ~/Library/LaunchAgents/com.ghyeong.remote-pair.plist 2>/dev/null || launchctl kickstart -k gui/$U/com.ghyeong.remote-pair
    launchctl bootstrap gui/$U ~/Library/LaunchAgents/com.ghyeong.remote-pair-watchdog.plist 2>/dev/null || true
    sleep 1
    echo "  loaded: $(launchctl list | grep com.ghyeong.remote-pair || echo none)"
    echo "deployed ✓"'

  echo ""
  echo "※ bundle id 가 새것(com.ghyeong.remote-pair)이라 1회 재grant 필요:"
  echo "   System Settings → 개인정보 보호 및 보안 → 손쉬운 사용 / 화면 기록 → RemotePair ON"
  echo "   (안 보이면 + 로 ~/Applications/RemotePair.app 추가). 이후엔 같은 cert 라 재빌드에도 유지."
fi
