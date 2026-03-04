# common.py — shared patch infrastructure
# Provides patch()/patch_all() + path variables for ruflo-patch.

import sys, os, re

base = os.environ.get("BASE", "")
if not base or base == "/dev/null":
    base = ""  # No claude-flow/cli, paths will be invalid (patch() will skip gracefully)
services = base + "/services" if base else ""
commands = base + "/commands" if base else ""
memory = base + "/memory" if base else ""

applied = 0
skipped = 0

def patch(label, filepath, old, new):
    global applied, skipped
    if not filepath:
        return  # Skip if path is empty (package not found)
    try:
        with open(filepath, 'r') as f:
            code = f.read()
        if new in code:
            skipped += 1
            return
        if old not in code:
            print(f"  WARN: {label} — pattern not found (code may have changed)")
            return
        code = code.replace(old, new, 1)
        with open(filepath, 'w') as f:
            f.write(code)
        print(f"  Applied: {label}")
        applied += 1
    except FileNotFoundError:
        pass  # Silently skip if file doesn't exist (package not installed)
    except Exception as e:
        print(f"  ERROR: {label} — {e}")

def patch_all(label, filepath, old, new):
    """Replace ALL occurrences"""
    global applied, skipped
    if not filepath:
        return  # Skip if path is empty (package not found)
    try:
        with open(filepath, 'r') as f:
            code = f.read()
        if new in code and old not in code:
            skipped += 1
            return
        if old not in code:
            print(f"  WARN: {label} — pattern not found")
            return
        code = code.replace(old, new)
        with open(filepath, 'w') as f:
            f.write(code)
        print(f"  Applied: {label}")
        applied += 1
    except FileNotFoundError:
        pass  # Silently skip if file doesn't exist (package not installed)
    except Exception as e:
        print(f"  ERROR: {label} — {e}")

# ── Target file paths ──
# These may be empty strings if base is not set (no claude-flow/cli found)
HWE = services + "/headless-worker-executor.js" if services else ""
WD = services + "/worker-daemon.js" if services else ""
DJ = commands + "/daemon.js" if commands else ""
DOC = commands + "/doctor.js" if commands else ""
MI = memory + "/memory-initializer.js" if memory else ""
INTEL = memory + "/intelligence.js" if memory else ""

MCP_MEMORY = base + "/mcp-tools/memory-tools.js" if base else ""
MCP_HOOKS = base + "/mcp-tools/hooks-tools.js" if base else ""
MEMORY_BRIDGE = memory + "/memory-bridge.js" if memory else ""
AGENTDB_TOOLS = base + "/mcp-tools/agentdb-tools.js" if base else ""
CLI_MEMORY = commands + "/memory.js" if commands else ""
CONF = commands + "/config.js" if commands else ""
HOOKS_CMD = commands + "/hooks.js" if commands else ""
NEURAL = commands + "/neural.js" if commands else ""
EMB_TOOLS = base + "/mcp-tools/embeddings-tools.js" if base else ""

# Init module
init = base + "/init" if base else ""
SETTINGS_GEN = init + "/settings-generator.js" if init else ""
HELPERS_GEN = init + "/helpers-generator.js" if init else ""
EXECUTOR = init + "/executor.js" if init else ""
TYPES = init + "/types.js" if init else ""
SWARM_CMD = commands + "/swarm.js" if commands else ""
CLI_INDEX = base + "/index.js" if base else ""
CLAUDEMD_GEN = init + "/claudemd-generator.js" if init else ""
INIT_CMD = commands + "/init.js" if commands else ""
START_CMD = commands + "/start.js" if commands else ""
STATUS_CMD = commands + "/status.js" if commands else ""
CMDS_INDEX = commands + "/index.js" if commands else ""

# Source helpers (shipped with package, copied by writeHelpers when source dir found)
_pkg_root = os.path.dirname(os.path.dirname(base)) if base else ""
_cf_scope = os.path.dirname(_pkg_root) if _pkg_root else ""
AGENTDB_BACKEND = os.path.join(_cf_scope, "memory", "dist", "agentdb-backend.js") if _cf_scope else ""
HYBRID_BACKEND = os.path.join(_cf_scope, "memory", "dist", "hybrid-backend.js") if _cf_scope else ""
CACHE_MANAGER = os.path.join(_cf_scope, "memory", "dist", "cache-manager.js") if _cf_scope else ""
SQLJS_BACKEND = os.path.join(_cf_scope, "memory", "dist", "sqljs-backend.js") if _cf_scope else ""
MEMORY_PKG_JSON = os.path.join(_cf_scope, "memory", "package.json") if _cf_scope else ""
SRC_HOOK_HANDLER = os.path.join(_pkg_root, ".claude", "helpers", "hook-handler.cjs") if _pkg_root else ""
SRC_INTELLIGENCE_CJS = os.path.join(_pkg_root, ".claude", "helpers", "intelligence.cjs") if _pkg_root else ""
SRC_AUTO_MEMORY_HOOK = os.path.join(_pkg_root, ".claude", "helpers", "auto-memory-hook.mjs") if _pkg_root else ""
SRC_STATUSLINE_CJS = os.path.join(_pkg_root, ".claude", "helpers", "statusline.cjs") if _pkg_root else ""
SRC_STATUSLINE_JS = os.path.join(_pkg_root, ".claude", "helpers", "statusline.js") if _pkg_root else ""
SRC_MEMORY_JS = os.path.join(_pkg_root, ".claude", "helpers", "memory.js") if _pkg_root else ""
SRC_SESSION_JS = os.path.join(_pkg_root, ".claude", "helpers", "session.js") if _pkg_root else ""
SRC_METRICS_DB = os.path.join(_pkg_root, ".claude", "helpers", "metrics-db.mjs") if _pkg_root else ""
SRC_LEARNING_SERVICE = os.path.join(_pkg_root, ".claude", "helpers", "learning-service.mjs") if _pkg_root else ""
SRC_GITHUB_SAFE = os.path.join(_pkg_root, ".claude", "helpers", "github-safe.js") if _pkg_root else ""
README_MD = os.path.join(_pkg_root, "README.md") if _pkg_root else ""

# Cross-package targets (sibling packages under node_modules/)
_nm_root = os.path.dirname(_cf_scope) if _cf_scope else ""
MEMORY_INDEX = os.path.join(_cf_scope, "memory", "dist", "index.js") if _cf_scope else ""
CONTROLLER_REGISTRY = os.path.join(_cf_scope, "memory", "dist", "controller-registry.js") if _cf_scope else ""
NEURAL_REASONING_BANK = os.path.join(_cf_scope, "neural", "dist", "reasoning-bank.js") if _cf_scope else ""
SHARED_DEFAULTS = os.path.join(_cf_scope, "shared", "dist", "core", "config", "defaults.js") if _cf_scope else ""

# RuVector (separate package, path set by patch-all.sh)
ruvector_cli = os.environ.get("RUVECTOR_CLI", "")

# ruv-swarm root (separate package, path set by patch-all.sh via discover.sh)
ruv_swarm_root = os.environ.get("RUV_SWARM_ROOT", "")
