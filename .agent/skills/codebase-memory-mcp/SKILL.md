---
name: codebase-memory-mcp
description: Guidelines for leveraging the MCP Knowledge Graph. Replaces grep/glob with Graph queries to find functions, classes, and call histories.
allowed-tools: mcp_codebase-memory-mcp_*
---

# Codebase Knowledge Graph (codebase-memory-mcp)

> **Mandatory Rule:** When exploring codebase structure, dependencies, or function logic, you MUST use MCP graph tools INSTEAD OF `grep`, `glob`, or basic file searches.

## 1. Core Principles & Priority Order

The codebase-memory-mcp server maintains a living knowledge graph of the project. It understands the abstract syntax and connections between code entities.

**Always follow this execution priority:**
1. **`search_graph`** — Find functions, classes, routes, or variables using name patterns.
2. **`trace_call_path`** — Discover who calls a specific function, or what internal calls a function makes.
3. **`get_code_snippet`** — Read the exact source code of a specific symbol/function.
4. **`query_graph`** — Run Cypher queries for highly complex, multi-hop architectural patterns.
5. **`get_architecture`** — High-level project summary to grasp dependencies at a glance.

**When to fall back to `grep` or `search_code`:**
- Searching for string literals, specific error messages, or hardcoded config values.
- Searching non-code files (Dockerfiles, `.json`, bash scripts, `.md`).
- When the MCP graph tools return insufficient results, or when searching CSS/HTML attributes.

---

## 2. The 3-Step Discovery Workflow

When tasked to investigate a bug or understand a feature, use this exact workflow:

### Step 1: Locate the Symbol (Search)
Use `search_graph` to find the exact target entity.
*Goal:* Obtain the `qualified_name` of the code block.
```json
// Example: Find the OrderHandler class
search_graph({
  "project": "www-wwwroot-disk.hydev.me-disk_usage",
  "name_pattern": ".*OrderHandler.*"
})
```

### Step 2: Understand the Context (Trace)
Use `trace_call_path` to map out its relationships before reading the code.
*Goal:* Identify dependencies and impact scope.
```json
// Example: Find what routes or functions call the OrderHandler
trace_call_path({
  "project": "www-wwwroot-disk.hydev.me-disk_usage",
  "function_name": "OrderHandler",
  "direction": "inbound", // "inbound" for callers, "outbound" for dependencies
  "depth": 2
})
```

### Step 3: Analyze the Logic (Read Code)
Use `get_code_snippet` with the exact `qualified_name` retrieved from Step 1.
*Goal:* Safely and precisely read the logic without opening the entire file.
```json
// Example: Read the internal logic of the handler
get_code_snippet({
  "project": "www-wwwroot-disk.hydev.me-disk_usage",
  "qualified_name": "pkg/orders.OrderHandler",
  "include_neighbors": false
})
```

---

## 3. Advanced Tool Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `search_graph` | Finds specific nodes (Functions, Classes, Variables). | `project` (REQUIRED), `name_pattern` (regex support), `label` |
| `search_code` | Graph-augmented grep code search. | `project` (REQUIRED), `pattern` (string/regex), `mode` |
| `trace_call_path` | Evaluates function impacts or upstream dependencies. | `project` (REQUIRED), `function_name`, `direction`, `depth` |
| `get_code_snippet` | The secure alternative to generic `view_file`. | `project` (REQUIRED), `qualified_name` |
| `query_graph` | Direct database access to the knowledge graph via Cypher. | `project` (REQUIRED), `query` (Cypher string), `max_rows` |

> 🔴 **CRITICAL:** ALL MCP tools require the `project` argument! If you don't know the project name, run `list_projects` first. Example project slug: `www-wwwroot-disk.hydev.me-disk_usage`.

---

## 4. Cypher Query Patterns (`query_graph`)

If standard tools fail to answer architectural questions, execute custom Cypher queries. 
**Database Schema:** Nodes generally possess labels like `Class`, `Function`, `Variable`, and properties like `name`, `file_path`. Relationships are labeled like `CALLS`, `DEFINES`, `IMPORTS`.

### Example: Find all functions in a file that are NEVER called
```json
// Tool: query_graph
{
  "project": "www-wwwroot-disk.hydev.me-disk_usage",
  "query": "MATCH (f:Function) WHERE f.file_path CONTAINS 'auth.js' AND NOT ()-[:CALLS]->(f) RETURN f.name, f.file_path"
}
```

### Example: Find the shortest dependency path between two components
```cypher
MATCH p=shortestPath((a:Function {name: 'processPayment'})-[*..5]->(b:Class {name: 'DatabaseLogger'}))
RETURN p
```

---

> **A Note to the Agent:** Your context limits are precious. By utilizing the `codebase-memory-mcp` tools, you drastically reduce token overhead by exclusively looking at relevant, graph-connected data structures instead of monolithic files. ALWAYS use this skill when handling logic modifications.
