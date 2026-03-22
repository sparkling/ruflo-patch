---
name: Never hang on pipeline commands — monitor actively
description: NEVER run pipeline commands in background and wait passively. Always monitor, detect errors, and react immediately.
type: feedback
---

NEVER run CI/CD pipeline commands (`npm run deploy`, `npm run build`, etc.) in background mode and passively wait. This causes 15-minute hangs.

**Why:** The user has been blocked multiple times by the assistant running a pipeline command in background, then sitting idle for 15 minutes until the user interrupts. The pipeline can fail in seconds (compile error, lock contention, missing dependency) but the assistant doesn't notice.

**How to apply:**
1. Run pipeline commands in FOREGROUND with a timeout: `timeout 120 npm run deploy 2>&1 | tee /tmp/log.log`
2. If the command needs longer, run in background BUT immediately poll every 5-10 seconds:
   ```bash
   npm run deploy 2>&1 | tee /tmp/log.log &
   PID=$!
   # Poll every 10s, check for completion or errors
   while kill -0 $PID 2>/dev/null; do
     sleep 10
     grep -c "error\|FAIL\|ERROR" /tmp/log.log
     tail -1 /tmp/log.log
   done
   wait $PID
   ```
3. ALWAYS check the exit code and full output immediately after completion
4. If a pipeline fails, diagnose and fix BEFORE re-running — never blindly retry
5. If something takes >60s with no new output, it's likely stuck — investigate immediately
