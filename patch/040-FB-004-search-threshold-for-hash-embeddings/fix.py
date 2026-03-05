# FB-004: Lower search threshold for hash-based embeddings
#
# Hash embeddings (generateHashEmbedding) produce cosine similarity ~0.1-0.28 for related texts
# vs ONNX embeddings which produce ~0.6-0.95. The 0.3 threshold filters out all hash results.
# Lower to 0.1 so search works with both embedding types.

# Op 1: Bridge search threshold
patch("FB-004a: lower bridge search threshold from 0.3 to 0.1",
    MEMORY_BRIDGE,
    """const { query: queryStr, namespace = 'default', limit = 10, threshold = 0.3 } = options;""",
    """const { query: queryStr, namespace = 'default', limit = 10, threshold = 0.1 } = options;""")

# Op 2: Initializer search threshold
patch("FB-004b: lower initializer search threshold from 0.3 to 0.1",
    MI,
    """const { query, namespace = 'default', limit = 10, threshold = 0.3, dbPath: customPath } = options;""",
    """const { query, namespace = 'default', limit = 10, threshold = 0.1, dbPath: customPath } = options;""")

# Op 3: CLI memory command hardcodes threshold = 0.3
patch("FB-004c: lower CLI memory search threshold from 0.3 to 0.1",
    CLI_MEMORY,
    """const threshold = ctx.flags.threshold || 0.3;""",
    """const threshold = ctx.flags.threshold || 0.1;""")

# Op 4: MCP memory-tools hardcodes threshold = 0.3
patch("FB-004d: lower MCP memory search threshold from 0.3 to 0.1",
    MCP_MEMORY,
    """const threshold = input.threshold || 0.3;""",
    """const threshold = input.threshold || 0.1;""")
