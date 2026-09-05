# Hypothesis Council MCP tools

Run `hypothesis-council-mcp` as a stdio MCP server. It exposes only the project workflow; provider
calls are delegated to the installed Rubber Duck MCP package. Running a research-proposal executor
against a repository is a CLI-only feature and is not exposed over MCP.

## `duck_hypothesis_council`

Starts a foreground council run.

Inputs:

- `goal` (required string)
- `providers` (optional string array)
- `context_paths` (optional string array)
- `context_root` (optional base directory for relative context paths)
- `markdown_only` (optional boolean)
- `hypotheses_per_provider`, `top_k`, `min_providers`, `seed`, `max_context_bytes` (optional)
- `novelty`, `skepticism` (optional; 0–10 or `low`/`medium`/`high`). When omitted, the server
  reads `HYPOTHESIS_COUNCIL_NOVELTY` / `HYPOTHESIS_COUNCIL_SKEPTICISM`, then the settings file in
  the session home, then defaults to 5.
- `sources_file` (optional path to a JSON or Markdown sources file; see the README "Sources"
  section for the accepted formats)
- `scouts` (optional string array of web-scout provider names; a scout is a Rubber Duck provider
  named `*_scout`, and scouts never sit on the council)
- `web` (optional `on` or `off`; omitted means automatic: scouting runs when a scout is
  configured). `off` skips scouting and every URL fetch.

Returns the durable session ID, final status, distinct-candidate count, and report path. Context is
sent to external providers.

## `duck_hypothesis_status`

Returns a public JSON snapshot for `session_id`, or the current session when omitted. Internal
author/reviewer provider labels are not returned; neither is the scout that proposed a source.

## `duck_hypothesis_report`

Returns the completed Markdown report for `session_id`, or the current session when omitted.

## `duck_hypothesis_ask`

Asks a read-only question grounded in a persisted session.

Inputs:

- `question` (required string)
- `session_id` (optional)
- `provider` (optional; must be one of the session's usable providers)

This tool does not rerank candidates or mutate the scientific workflow.

## `duck_research_proposal`

Starts a research proposal. Every provider independently proposes clarifying questions about the
topic; the questions are merged and returned without author labels. Once the interview is
complete the providers draft independently, each draft is critiqued blind by a non-author, and
the ranked drafts are merged into one proposal.

Inputs:

- `topic` (required string)
- `providers`, `context_paths`, `context_root`, `markdown_only` (optional; as for the council tool)
- `from_session_id` (optional council session to build on)
- `interview` (optional boolean; `false` skips the interview and drafts immediately)
- `max_rounds` (optional integer 1–5; interview rounds the council may ask for)
- `answers` (optional object mapping question ids such as `Q-001` to an answer string, or `null`
  to skip the question)
- `novelty`, `skepticism` (optional; resolved as for the council tool)

Returns the public proposal snapshot: the `RP-...` session id, the stage, open questions, and,
once drafted, the ranked drafts with their critiques and the merged proposal. Author, critic, and
synthesizer identities are never returned. When nothing remains to answer (or `interview` is
`false`) the proposal is drafted before the tool returns.

## `duck_research_proposal_answer`

Answers or skips open interview questions and moves the proposal forward.

Inputs:

- `session_id` (optional; the current proposal when omitted)
- `answers` (optional object: question id to answer string, or `null` to skip)
- `next_round` (optional boolean; ask the council for another interview round once everything is
  answered)
- `finish` (optional boolean; end the interview early, skipping any open question)
- `draft` (optional boolean, default `true`; draft, critique, and merge as soon as the interview
  is complete)

Returns the public proposal snapshot.

## `duck_research_proposal_report`

Returns the Markdown of a merged proposal for `session_id`, or the current proposal when omitted:
the interview transcript, the ranked drafts with their blind critiques, and the proposal. The
tool errors while the proposal is not ready and says which stage the session is in.
