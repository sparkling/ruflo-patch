# Preferences

## CRITICAL: Self-Aware Answering Protocol

**When the user asks ANY question about claude-flow, ALWAYS ask claude-flow about itself first.**
Do NOT guess, read source, or check GitHub. Run the matching CLI command(s) below and answer from the output.

### Question → Tool Routing Map

| User asks about... | Run this command |
|---|---|
| "Is it healthy?" / "Is it working?" / "What's broken?" | `doctor` (or `doctor --fix`) |
| "What's happening?" / "What's running?" / current state | `status` |
| "What has it learned?" / patterns / knowledge | `neural patterns --list` |
| "How smart is it?" / neural / SONA / MoE status | `neural status` |
| "How does routing work?" / "Why did it pick X agent?" | `hooks explain --task "[topic]"` |
| "What agent should handle X?" / routing a task | `hooks route --task "[description]"` |
| "How is it performing?" / metrics / accuracy | `hooks metrics` |
| "What does it know about X?" / memory lookup | `memory search --query "[topic]"` |
| "What's stored in memory?" / list entries | `memory list --namespace [ns]` or `memory stats` |
| "What workers are running?" / daemon status | `daemon status` |
| "What workers exist?" / worker capabilities | `hooks worker list` |
| "How are workers doing?" / worker health | `hooks worker status` |
| "What intelligence data?" / trajectories / patterns | `hooks intelligence stats` |
| "How far along is V3?" / implementation progress | `progress` |
| "How fast is it?" / benchmarks / profiling | `performance report` |
| "What rules govern it?" / policies / constitution | `guidance` |
| "What plugins are installed?" | `plugins list` |
| "What config is set?" | `config list` |
| "What sessions exist?" / session history | `session list` |
| "What can it do?" / capabilities overview | read `.claude-flow/CAPABILITIES.md` |
| Security posture / vulnerabilities | `security scan` |
| "How would it handle task X?" / pre-task analysis | `hooks pre-task --description "[task]"` |

### Resolution Order (ALWAYS follow this)
1. **Run the matching CLI command(s)** from the table above
2. **Check memory** with `memory search --query "[topic]"` if CLI doesn't fully answer
3. **Only then** fall back to reading source code or docs

### Prefix for all CLI commands
```
npx @claude-flow/cli@latest [command]
```

### Multiple questions = parallel commands
If the user asks about multiple things, run all matching commands in parallel in one message.

## Browser Automation
- MCP tools: browser_open, snapshot, click, fill, eval, screenshot, etc.
- Uses Playwright under the hood via `agent-browser` CLI (not installed by default)
- Install: `npm install -g agent-browser` (needs Playwright browsers too)

## Entire CLI (Session Capture)
- **Binary**: `~/go/bin/entire` (v0.4.4) — added to PATH via ~/.bashrc
- **Purpose**: Captures AI agent sessions in Git, linking transcripts to commits
- **Enabled**: gene-clean project, `auto-commit` strategy
- **Docs**: https://docs.entire.io | **Repo**: https://github.com/entireio/cli
- See `entire-cli.md` for full reference
