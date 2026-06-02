-- engine.applescript — auto-approve 실행 엔진 (런타임 로드용, 재빌드 0)
-- loader(.app)가 매 주기 이 파일을 `load script` 하여 tick() 을 호출한다.
-- 위치: ~/.claude/auto-approve/engine.applescript  (loader 가 홈 기준 자동 감지)
-- 고치면 다음 tick 에 자동 반영 — .app 재빌드 불필요.

property cliclick : ""

on homePath()
	return POSIX path of (path to home folder)
end homePath

on rulesPath()
	return homePath() & ".claude/auto-approve/rules.txt"
end rulesPath

on logPath()
	return homePath() & ".claude/logs/auto-approve.log"
end logPath

on heartbeatPath()
	return homePath() & ".claude/logs/auto-approve.heartbeat"
end heartbeatPath

-- loader 가 매 주기 호출하는 진입점. 단일 책임: 승인 다이얼로그 클릭.
-- (구 serve/inbox 책임은 폐기됨 — tmux 세션 기동은 launcher 가 sudo claude-aqua-tmux
--  로 직접 한다. asuser audit-session 이 daemon() 으로 잃은 Aqua 세션을 되살린다.)
on tick()
	ensureCliclick()
	heartbeat()
	if not seReachable() then return
	-- 승인 다이얼로그 클릭 (권한 필요)
	set theRules to loadRules()
	repeat with r in theRules
		scanTarget(r)
	end repeat
end tick

on ensureCliclick()
	if cliclick is not "" then return
	repeat with p in {"/opt/homebrew/bin/cliclick", "/usr/local/bin/cliclick"}
		try
			do shell script "test -x " & quoted form of (p as text)
			set cliclick to (p as text)
			exit repeat
		end try
	end repeat
end ensureCliclick

-- 규칙은 외부 rules.txt(순수 텍스트 데이터)에서 매번 읽고 파싱한다.
-- 형식 한 줄: proc <TAB> mode <TAB> label|label|...   ("#" 시작은 주석)
-- → 규칙만 고치면 컴파일 없이 즉시 반영.
on loadRules()
	set out to {}
	try
		set raw to read (POSIX file (rulesPath())) as «class utf8»
	on error
		return {}
	end try
	set savedTID to AppleScript's text item delimiters
	try
		repeat with para in (paragraphs of raw)
			set s to (para as text)
			if s is not "" and s does not start with "#" then
				set AppleScript's text item delimiters to tab
				set parts to text items of s
				if (count of parts) is greater than or equal to 3 then
					set prc to (item 1 of parts)
					set md to (item 2 of parts)
					set AppleScript's text item delimiters to "|"
					set lbls to text items of (item 3 of parts)
					set end of out to {proc:prc, labels:lbls, mode:md}
				end if
			end if
		end repeat
	on error errMsg number errNum
		set AppleScript's text item delimiters to savedTID
		writeLog("rules parse fail " & errNum & " " & errMsg)
		return out
	end try
	set AppleScript's text item delimiters to savedTID
	return out
end loadRules

-- 진짜 UI 스크립팅(Accessibility)을 건드려서 권한 여부를 확인한다.
-- `count processes` 는 Automation 만으로 통과(false positive)라 못 쓴다.
on seReachable()
	try
		with timeout of 4 seconds
			tell application "System Events"
				tell process "Dock" to count UI elements
			end tell
		end timeout
		return true
	on error
		return false
	end try
end seReachable

-- r = {proc:"프로세스명", labels:{라벨...}, mode:"ax"|"coord"}
on scanTarget(r)
	set procName to (proc of r)
	set theLabels to (labels of r)
	set theMode to "ax"
	try
		set theMode to (mode of r)
	end try
	try
		with timeout of 4 seconds
			tell application "System Events"
				if not (exists process procName) then return
				tell process procName
					if (count of windows) is 0 then return
					set win to window 1
					set btns to {}
					try
						set btns to buttons of win
					end try
					try
						repeat with sh in (sheets of win)
							set btns to btns & (buttons of sh)
						end repeat
					end try
					try
						repeat with g in (groups of win)
							set btns to btns & (buttons of g)
						end repeat
					end try
					repeat with want in theLabels
						set wantStr to (want as text)
						repeat with b in btns
							if my matchesLabel(b, wantStr) then
								my clickButton(b, procName, wantStr, theMode)
								return
							end if
						end repeat
					end repeat
				end tell
			end tell
		end timeout
	on error errMsg number errNum
		writeLog("blocked [" & procName & "] " & errNum & " " & errMsg)
	end try
end scanTarget

on clickButton(b, procName, wantStr, theMode)
	if theMode is "coord" then
		coordClick(b, procName, wantStr)
		return
	end if
	-- ax (기본): AX 논리 클릭 시도, 실패 시 좌표 폴백
	try
		tell application "System Events" to click b
		writeLog("clicked [" & procName & "] " & wantStr)
	on error
		coordClick(b, procName, wantStr)
	end try
end clickButton

on matchesLabel(b, wantStr)
	tell application "System Events"
		try
			if ((name of b) as text) is wantStr then return true
		end try
		try
			if ((description of b) as text) is wantStr then return true
		end try
		try
			if ((title of b) as text) is wantStr then return true
		end try
	end tell
	return false
end matchesLabel

on coordClick(b, procName, wantStr)
	set cx to 0
	set cy to 0
	tell application "System Events"
		try
			set pos to position of b
			set sz to size of b
			set cx to (item 1 of pos) + ((item 1 of sz) div 2)
			set cy to (item 2 of pos) + ((item 2 of sz) div 2)
		on error
			my writeLog("blocked [" & procName & "] " & wantStr & " no-geom")
			return
		end try
	end tell
	if cliclick is not "" then
		try
			do shell script (quoted form of cliclick) & " c:" & cx & "," & cy
			writeLog("coord [" & procName & "] " & wantStr & " @ " & cx & "," & cy)
		on error
			writeLog("blocked [" & procName & "] " & wantStr & " coord-fail @ " & cx & "," & cy)
		end try
	else
		writeLog("skip [" & procName & "] " & wantStr & " needs cliclick @ " & cx & "," & cy)
	end if
end coordClick

on heartbeat()
	try
		do shell script "touch " & quoted form of (heartbeatPath())
	end try
end heartbeat

on writeLog(msg)
	try
		set ts to do shell script "date '+%Y-%m-%d %H:%M:%S'"
		do shell script "printf '%s %s\\n' " & quoted form of ts & " " & quoted form of (msg as text) & " >> " & quoted form of (logPath())
	end try
end writeLog
