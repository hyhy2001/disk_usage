# Skill Requirements Analysis: codebase-memory-mcp

This project utilizes `codebase-memory-mcp` (an MCP plugin) to manage the codebase knowledge in a Knowledge Graph format. The goal of this task is to build a standard skill file (`SKILL.md`) located at `.agent/skills/codebase-memory-mcp/` to help any Agent in the Antigravity Kit understand and use this MCP seamlessly, replacing traditional `grep` or `glob` whenever applicable.

## Success Criteria
- [ ] The file `.agent/skills/codebase-memory-mcp/SKILL.md` is created with a clear and standard Frontmatter.
- [ ] List all the primary tools of codebase-memory-mcp (`search_graph`, `trace_call_path`, `get_code_snippet`, `query_graph`, etc.).
- [ ] Establish strict Priority Rules: The Knowledge Graph approach MUST be prioritized before falling back to `grep`.
- [ ] Provide practical usage examples.

## Project Type
**WEB / BACKEND / TOOLS** (A globally applicable skill for AI Agents).

## File Structure

```text
.agent/
└── skills/
    └── codebase-memory-mcp/
        └── SKILL.md        # The main skill instruction file
```

---

## Task Breakdown

### 1. Outline the Frontmatter Structure for SKILL.md
- **Agent**: `project-planner` / `orchestrator`
- **Skill**: `plan-writing`
- **INPUT**: Expected YAML structure.
- **OUTPUT**:
  ```yaml
  ---
  name: codebase-memory-mcp
  description: Guidelines for leveraging the MCP Knowledge Graph. Replaces grep/glob with Graph queries to find functions, classes, and call histories.
  allowed-tools: mcp_codebase-memory-mcp_*
  ---
  ```
- **VERIFY**: The YAML is perfectly valid system-format.

### 2. Define Principles and Priority Order
- **Agent**: `backend-specialist`
- **Skill**: `clean-code`
- **INPUT**: Ban excessive usage of bash/grep.
- **OUTPUT**: Instruct the Agent to always utilize `search_graph` → `trace_call_path` → `get_code_snippet` successively as their P0 move.
- **VERIFY**: Contains a concise explanation of why Graph searches are statistically safer and faster than Regex.

### 3. Provide API / Tool Reference
- **Agent**: `orchestrator`
- **INPUT**: Tools including `search_graph`, `trace_call_path`, `get_code_snippet`, `query_graph`, `get_architecture`.
- **OUTPUT**: A clean summarization table mapping tools to their primary use cases and arguments.
- **VERIFY**: Include real parameter examples (ex: `name_pattern`, `direction`).

### 4. Provide Cypher Query Patterns
- **Agent**: `backend-specialist`
- **INPUT**: Strategies if `search_graph` does not suffice.
- **OUTPUT**: Cypher Query templates for complex node exploration.
- **VERIFY**: Queries must be explicit, valid, and safe.

---

## Phase X: Verification Checklist

### ✅ Mandatory Checklist
- [x] Directory `.agent/skills/codebase-memory-mcp/` exists.
- [x] `SKILL.md` parses cleanly as YAML.
- [x] Markdown structures (Tables, Code blocks) format correctly.
- [x] Invoking `view_file` on `SKILL.md` returns complete guidelines.

*(Note: Once the verification is executed, automatically check the `[x]` marks in this plan).*
