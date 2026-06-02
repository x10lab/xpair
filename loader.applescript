-- loader.applescript — AutoApprove.app 으로 굽는 골격.  ★ 한 번만 빌드하면 됨.
--
-- 역할: Accessibility 권한만 보유하고, 실제 로직(engine.applescript)을
--       ~/.claude/auto-approve/ 에서 홈 기준 자동 감지해 실행한다.
--
-- load script 는 컴파일된 .scpt 만 받으므로(텍스트 .applescript 는 -1752),
-- loader 가 engine.applescript 의 mtime 을 보고 바뀌었을 때만 osacompile → load script 한다.
--   → 너는 engine.applescript 텍스트만 고치면 다음 주기에 자동 반영 (.app 재빌드 불필요).
--   → .app 이 외부 스크립트를 자기 프로세스에서 실행하므로 AX 권한이 그대로 상속된다.
--   → .app 만 배포하면 각 머신이 자기 ~/.claude 를 읽는다 (경로 하드코딩 없음).
--
-- 빌드: Lang-Swift/auto-approve/build.sh   (한 번만)

property engMtime : ""
property eng : missing value
property lastErr : ""

on run
	repeat
		try
			set engSrc to (POSIX path of (path to home folder)) & ".claude/auto-approve/engine.applescript"
			-- 소스가 바뀌었을 때만 재컴파일 (평소엔 로드된 객체 재사용 → 빠름)
			set m to do shell script "/usr/bin/stat -f %m " & quoted form of engSrc
			if m is not engMtime or eng is missing value then
				set scpt to "/tmp/aa-engine.scpt"
				do shell script "/usr/bin/osacompile -o " & quoted form of scpt & " " & quoted form of engSrc
				set eng to load script (POSIX file scpt)
				set engMtime to m
			end if
			tell eng to tick()
			set lastErr to "" -- 정상 복귀 시 에러 상태 해제
		on error errMsg number errNum
			noteErr((errNum & " " & errMsg) as text)
		end try
		delay 1
	end repeat
end run

-- engine 미존재/컴파일 에러 시 같은 메시지를 반복 기록하지 않는다 (sync 전 스팸 방지).
on noteErr(e)
	if e is lastErr then return
	set lastErr to e
	try
		set lf to (POSIX path of (path to home folder)) & ".claude/logs/auto-approve.log"
		set ts to do shell script "date '+%Y-%m-%d %H:%M:%S'"
		do shell script "printf '%s loader: %s\\n' " & quoted form of ts & " " & quoted form of e & " >> " & quoted form of lf
	end try
end noteErr
