# Hypothesis Council: reviewed Slice 1 design

This document reconciles the original specification with the human-facing CLI and the decision to
use Rubber Duck strictly through its published MCP package.

## Review outcome

The long-term design has a strong scientific spine: independent generation, authorship-label
blinding, falsification, preserved dissent, equal recorded context, stable identity, and inspectable
artifacts. Its original “MVP” combined most of the roadmap—semantic deduplication, Elo, evolution,
SQLite, exact resume, and meta-review—and was therefore narrowed to a first vertical slice.

## Package boundary

Hypothesis Council pins `mcp-rubber-duck@1.20.5`; it does not vendor Rubber Duck source. The npm
package is an executable MCP server rather than an importable provider library, so Hypothesis
Council launches the package entry point and calls its public tools over stdio.

```text
CLI or Hypothesis Council MCP server
                ↓
shared research service and session store
                ↓
Rubber Duck MCP client adapter
                ↓
installed mcp-rubber-duck subprocess
                ↓
configured HTTP and vendor CLI providers
```

One Rubber Duck subprocess is reused for all calls in a single session operation. Its working
directory is the isolated session directory, preventing autonomous vendor CLIs from operating in
the user's repository. Environment variables and the normal
`~/.mcp-rubber-duck/config.json` configuration are inherited.

Provider discovery uses `list_ducks`. If its human-readable presentation changes, the adapter
falls back to the provider enum in the public `ask_duck` tool schema. `ask_duck` presentation
headers, token counts, and latency text are removed before structured research parsing.

An `AbortSignal` is sent with MCP requests. Cancellation also closes the session transport because
Rubber Duck 1.20.5 does not guarantee that cancellation reaches every underlying vendor CLI. This
terminates the Rubber Duck server and rejects concurrent MCP calls, but an already-spawned vendor
CLI grandchild may remain alive until its configured provider timeout. Strong process-tree
cancellation requires an upstream capability or a platform-specific supervisor.

## Slice 1 workflow

```text
explicit goal + context preview
            ↓
parallel independent generation (sealed)
            ↓
deterministic lexical duplicate clustering
            ↓
balanced authorship-label-blinded review
            ↓
deterministic preliminary ordering
            ↓
adversarial falsification of finalists
            ↓
inspect candidates, ask follow-ups, export report
```

Initial generation calls receive identical prompts and context. Results are not parsed or exposed
until the complete initial batch settles. Candidate IDs are allocated by sorted provider name and
generation index, never promise completion order.

Structured output parsing tries direct JSON, fenced JSON, and the first balanced JSON value in
prose, followed by one provider-local repair attempt. Required scientific fields are never
fabricated.

Review prompts receive a public candidate projection without author/model metadata. Assignments
are deterministic, balanced, and avoid self-review when another provider is available. This is
label blinding, not stylistic anonymity.

The preliminary ranking is an explainable mean of six review dimensions. Fatal flaws gate a
candidate below non-fatal candidates. Scores are prioritization signals, not calibrated truth
probabilities.

## Product contract

Interactive mode and script commands share the same application service. Plain chat does not start
or mutate council work. Session chat is grounded in persisted candidates, reviews, and attacks.

Runs are foreground-owned. Ctrl-C closes the live Rubber Duck MCP subprocess and leaves completed
stage checkpoints on disk, subject to the vendor-grandchild limitation above. There is no detached
mode until the project has a durable worker, ownership, and heartbeat semantics.

The standalone MCP server exposes the same workflow as four normal foreground tools. Persistent
session data—not an in-memory MCP task handle—is authoritative.

## Persistence and context

Slice 1 uses atomic, permission-restricted JSON checkpoints and separate raw/parsed artifacts. This
supports one foreground writer and concurrent readers. SQLite migrations, WAL, idempotency keys,
and exactly-once updates are required before detached or simultaneous workers.

The CLI treats the current directory (or `--repo`) as the repository and includes supported text
and code files by default. `--context` narrows that selection and `--markdown-only` limits it to
Markdown/MDX. Ordering and truncation are deterministic; symlinks, generated directories, common
credential paths, and local settings files are denied; and a manifest records hashes, omissions,
and truncation.

The packet size is derived from every selected provider's model window. Prompt and output capacity
are reserved, then one shared budget is set to the smallest remaining capacity so every independent
generator receives identical evidence. Concrete model identifiers use the built-in limit table;
unknown provider defaults can be overridden with
`HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_<PROVIDER>`. Argument-based CLI providers receive an additional
transport-safe cap. The wrapper converts Rubber Duck's unmodified Codex and Claude presets to stdin
to avoid that cap and to remove the obsolete Codex `--full-auto` option. Usable tokens are converted
with a three-UTF-8-bytes-per-token estimate; packet framing and content are then enforced against the
resulting byte limit exactly.

Large repositories start with a bounded file-path manifest and fair excerpts from as many eligible
files as fit. Remaining capacity is assigned deterministically, prioritizing root instructions and
metadata, Markdown, documentation/research, source, and then tests. The recorded packet byte count,
not just raw file content, must fit the selected budget.

## Test contract

Each wrapper component has a focused unit test:

- package entry-point resolution and environment forwarding;
- lazy SDK peer connection, tool forwarding, and close behavior;
- provider discovery, compatibility fallback, envelope removal, errors, and abort cleanup;
- one-client-per-session gateway isolation;
- runtime ownership on success and failure;
- Hypothesis Council MCP tool registration through an in-memory transport.

Workflow tests use a scripted provider to verify independence, repair, label removal, balanced
assignment, falsification, artifacts, reporting, and grounded follow-up answers. No normal test
contacts a live provider.

## Later slices

1. Replace file storage with versioned SQLite, WAL, and idempotent stage recovery.
2. Add multiple blinded reviews, explicit tie policy, call budgets, and stage timeouts.
3. Add position-balanced pairwise evaluation with deterministic Elo application order.
4. Add immutable evolution lineage and a synthesizer that explains but cannot override ranking.
5. Add an explicit experiment-feedback loop and preserve unresolved dissent in every report.

Only then should the project claim conformance with the original specification’s complete MVP.
