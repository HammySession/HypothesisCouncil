# Hypothesis Council MCP tools

Run `hypothesis-council-mcp` as a stdio MCP server. It exposes only the project workflow; provider
calls are delegated to the installed Rubber Duck MCP package.

## `duck_hypothesis_council`

Starts a foreground council run.

Inputs:

- `goal` (required string)
- `providers` (optional string array)
- `context_paths` (optional string array)
- `context_root` (optional base directory for relative context paths)
- `markdown_only` (optional boolean)
- `hypotheses_per_provider`, `top_k`, `min_providers`, `seed`, `max_context_bytes` (optional)

Returns the durable session ID, final status, distinct-candidate count, and report path. Context is
sent to external providers.

## `duck_hypothesis_status`

Returns a public JSON snapshot for `session_id`, or the current session when omitted. Internal
author/reviewer provider labels are not returned.

## `duck_hypothesis_report`

Returns the completed Markdown report for `session_id`, or the current session when omitted.

## `duck_hypothesis_ask`

Asks a read-only question grounded in a persisted session.

Inputs:

- `question` (required string)
- `session_id` (optional)
- `provider` (optional; must be one of the session's usable providers)

This tool does not rerank candidates or mutate the scientific workflow.
