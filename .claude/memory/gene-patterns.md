# Project Patterns

## Self-Awareness & Services Report
- Full report: [self-awareness-report.md](self-awareness-report.md)
- 12 self-awareness mechanisms, 150+ MCP tools (23 categories), 26 CLI commands (140+ subcommands)
- 93 agent definitions, 27 hooks, 12 daemon workers, 5 consensus protocols, 6 topologies
- Key: Doctor (13 checks), Self-Learning Hooks (6), Neural (SONA+ReasoningBank), Q-Learning+MoE+3-Tier routing
- Memory: HNSW+AgentDB, Session persistence, Guidance control plane, Coverage-aware routing

## Patch Review Process (gene-clean)
- Patches are in ~/src/claude-patch/ (git repo)
- NPX cache: ~/.npm/_npx/85fb20e3e7e3a233/node_modules/@claude-flow/cli/dist/src/
- check-patches.sh auto-reapplies patches — don't use it to "verify"
- npm tarball is completely unpatched — ALL patches needed
- 32-core Linux server: maxCpuLoad set to 28.0
- Embedding model: all-mpnet-base-v2 (768-dim) from .claude-flow/embeddings.json
- Patch 8: config-driven (reads from embeddings.json, not hardcoded)
- Patch 10: DELETED (cold-start only, not worth it)

## Final Patch Status
- Applied: 1, 2, 3, 4, 5, 7, 8 (config-driven), 9, 11, 12, 16, 17, 18, 19a-e, 20a-i, 21a-j, 22a-d, 23a-i
- Skipped: 6 (macOS only), 14 (already applied on server)
- Deleted: 10 (cold-start only), 13 (wrong intent per ADR-020), 15 (already resolved)
- Ultralearn: reverted to upstream disabled/manual-trigger per ADR-020
- Patch 19 (6 ops): Search → 'all' — issues #1131, #1123 (duplicate)
- Patch 20 (9 ops): Write ops require namespace — issue #581
- Patch 21 (10 ops): Read ops — retrieve requires ns, list defaults 'all' — issue #1135
- Patch 22 (4 ops): 'pattern'→'patterns' typo — issue #1136
- Patch 23 (9 ops): Block namespace='all' on store/delete/retrieve — issue #1137
- Namespace patches reorganized by problem (A-E), not discovery order. Old 19-24 → new 19-22; Patch 23 added for sentinel blocking.
- Design basis: ADR-006 (namespace required) + README examples. "ADR-050" was a misnomer — corrected.

## rUv Project Ecosystem
- Full list in [ruv-projects.md](ruv-projects.md) — 22 paginated + 5 featured + 10 frameworks from ruv.net/projects
- Categories: Research, Infrastructure, Security, Analytics, Trading, Robotics, AI/ML, Database
- Key projects: Claude-Flow, Agentic-Flow, AgentDB, Flow Nexus, RuVector, ruv-swarm, FACT, QuDAG, SPARC, DSPy.ts
- GitHub: 80+ repos at github.com/ruvnet

## Environment
- 32-core Linux server, maxCpuLoad: 28.0
- 16/16 plugins loaded, 37/37 tests passing
- Doctor: 12/13, Guidance: 100/100
- HNSW active, 30 neural patterns trained
- @ruvector/core@0.1.30 + @ruvector/sona@0.1.5 + @ruvector/rvdna@0.1.1 installed

## @ruvector/rvdna (v0.1.1)
- AI-native genomic analysis + `.rvdna` binary file format
- Rust via NAPI-RS with pure JS fallbacks for basic ops
- **JS fallback functions**: encode2bit, decode2bit, translateDna, cosineSimilarity
- **Native-only functions**: fastaToRvdna, readRvdna (need platform-specific binary)
- `isNativeAvailable()` checks if native Rust bindings loaded
- encode2bit: A=00, C=01, G=10, T=11, N→A; 4 bases/byte
- translateDna: standard genetic code, stops at first stop codon (TAA/TAG/TGA)
- .rvdna format: 8-byte magic "RVDNA\x01\x00\x00", 64-byte header, then sections (seq, k-mer vectors, attention, variants, protein embeddings, epigenomic, metadata)
- fastaToRvdna options: k (default 11), dims (default 512), blockSize (default 500)
- Platform packages: @ruvector/rvdna-linux-x64-gnu, -darwin-arm64, -win32-x64-msvc, etc.
- Same NAPI-RS pattern as @ruvector/gnn (platform switch in index.js)
- TypeScript types in index.d.ts (RvdnaFile, RvdnaOptions interfaces)
- Lockfile note: `npm install` needs `--legacy-peer-deps` due to @claude-flow alpha peer dep conflicts; also had to remove 15 empty-version lockfile stubs for missing optional platform packages
