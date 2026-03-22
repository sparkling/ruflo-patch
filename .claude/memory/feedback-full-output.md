---
name: Always capture full command output
description: Never truncate build/test output with tail/head — always capture full output to a log file
type: feedback
---

Always capture full output from builds and tests to a log file using `tee`. Never use `tail -N` or `head -N` to truncate output.

**Why:** Truncated output hides errors, makes debugging impossible, and wastes time re-running commands.

**How to apply:** Use `command 2>&1 | tee /tmp/logfile.log` for all build/test commands. Read the full log file afterward with the Read tool instead of grepping fragments.
