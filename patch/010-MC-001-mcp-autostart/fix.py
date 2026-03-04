# MC-001: MCP claude-flow server fails to start due to autoStart: false

MCP_GEN = init + "/mcp-generator.js" if init else ""

patch("MC-001a: remove autoStart from claude-flow MCP entry",
    MCP_GEN,
    """CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
        }, { autoStart: config.autoStart });""",
    """CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
        });""")
