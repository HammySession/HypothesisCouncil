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

Council presets resolve one model per vendor before the subprocess starts.
`src/cli/model-discovery.ts` reads the vendor CLIs' own catalog files field by field (ids,
display names, context windows, visibility, upgrade pointers; never credentials) or runs their
read-only listing commands (`codex debug models`, `grok models`, `agy models`), and
`src/cli/model-selection.ts` ranks the result. The choice reaches Rubber Duck only through its
public `*_DEFAULT_MODEL` variables and the council's own `HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_*`
overrides; a normalised copy of the listings lives in `<session home>/models-cache.json`.

Web scouts are ordinary Rubber Duck custom CLI providers whose names end in `_scout` or
`-scout`. `src/rubber-duck/scout-profiles.ts` builds them from the same vendor CLIs with web
search left on: Claude restricted to `WebSearch` and `WebFetch`, Codex with `web_search="live"`
(overridable through `HYPOTHESIS_COUNCIL_CODEX_WEB_SEARCH_CONFIG`), Grok without
`--disable-web-search`, and Gemini through the stream-json shim. The name is the contract: the
research layer treats any `*_scout` provider as web-enabled, uses it only in the sources stage,
and never seats it on the council, whichever way `--web` is set. `hc doctor` reports each
provider's web access and flags a council member with web access or a scout without it.

`src/executor/` is the one module that spawns a vendor CLI directly rather than through Rubber
Duck. It runs a single research-proposal executor with a user-confirmed repository as its
working directory, is never imported by `src/research/`, contains no MCP code, and is configured
through `HYPOTHESIS_COUNCIL_EXECUTOR_*` variables only.

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
optional sources stage: supplied file + web scouts → mechanical verification → blind critique
            ↓
parallel independent generation (sealed)
            ↓
deterministic evidence-provenance verification
            ↓
lexical duplicate clustering + consensus-crowding measurement
            ↓
balanced authorship-label-blinded review
            ↓
deterministic preliminary ordering (fatal and untestable-falsifier gates)
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

## Epistemic guardrails

Models trained on the same literature tend to restate consensus and to treat remembered sources
as evidence, so the workflow makes falsifiability and provenance structural rather than
rhetorical:

- Every hypothesis must state `differsFromConsensus` — an observable way it disagrees with the
  textbook or most obvious explanation — because restated consensus is recall, not a hypothesis.
- Every load-bearing supporting claim is tagged with its basis: `context` (with a verbatim
  quote), `general-knowledge` (remembered literature, treated as unverified authority), or
  `speculation` (legitimate when tagged). A deterministic local pass checks each context quote
  against the sealed packet and records `verified`, `unverified`, or `not-applicable`; no model
  is consulted, so memory cannot be laundered into grounded evidence. Reviewers see the tags and
  are instructed not to accept remembered literature on authority.
- Reviewers grade the declared falsifier as `concrete`, `vague`, or `untestable`. An untestable
  kill criterion gates the candidate below every testable one — above only fatal flaws — so a
  hypothesis nothing could refute cannot win on eloquence. Reviews persisted before the grade
  existed never gate.
- After deduplication, cross-provider convergence is measured at a lower similarity threshold
  than duplicate clustering and recorded as consensus crowding. Agreement between models that
  share training literature is consensus recall, not independent replication: crowding is
  reported as a caution (and as a session warning when at least half the batch converged) and
  never raises a candidate's rank. Same-provider repetition does not count.

Review prompts receive a public candidate projection without author/model metadata. Assignments
are deterministic, balanced, and avoid self-review when another provider is available. This is
label blinding, not stylistic anonymity.

The preliminary ranking is an explainable weighted mean of six review dimensions. Fatal flaws
gate a candidate below non-fatal candidates, and an untestable declared falsifier gates below
every testable candidate. Above the default novelty level a consensus-crowded candidate loses a
fixed number of points; above the default skepticism level a candidate with no verified context
evidence loses points, and from level 8 it also ranks below every verified candidate. Scores are
prioritization signals, not calibrated truth probabilities, and novelty is reported alongside the
aggregate so speculative-but-testable ideas stay visible next to plausible-but-boring ones.

### Dials

Two integer dials (0–10, aliases `low`/`medium`/`high` = 2/5/8) are resolved once per run from
flag, environment variable, settings file, or default, and persisted on the session together with
their origins and the derived `DialPolicy` (`src/research/dials.ts`). Level 5/5 reproduces the
constants the council used before dials existed.

- **Novelty** scales the novelty weight, lowers the crowding similarity threshold, adds a crowding
  penalty above 5, and from level 8 adds one extra sealed `hypothesis-generation-outofbox` call per
  provider whose prompt demands hypotheses that contradict the dominant explanation. Out-of-the-box
  batches are generated in the same sealed `Promise.all` as the standard batches, so the
  independence barrier is unchanged.
- **Skepticism** scales the robustness weight, adds an unsupported-evidence penalty above 5, and
  from level 8 gates unverified finalists and runs a second independent falsification round per
  finalist. Round two prefers an attacker who has not yet seen the finalist; the attacker never sees
  round one, and when only the author remains the report records that warning.

Prompts carry a `DIALS:` line so every raw output records the levels it was produced under, and
guidance blocks appear only at the extremes (2 and below, 8 and above) so mid-range runs keep the
baseline prompts. The report's "Session configuration" section prints the levels, their origins,
and the ranking rules in words.

## Sources and web scouting

The sources stage runs before generation, and only when the run supplies a sources file, names
scouts, or a `*_scout` provider is configured while `--web` is `auto`. Records have two origins:
`user`, parsed from a JSON or Markdown file by `src/research/sources.ts`, and `scout`, proposed by
web-enabled providers that receive the goal, the dial policy, the ids already collected, and the
context manifest's file paths, never the packet itself. Each record gets a stable `S-###` id in
collection order.

Verification is mechanical. `src/research/source-verify.ts` fetches each URL or DOI with
redirects followed by hand (at most five), loopback and private-network hosts refused, bodies
capped at 256 KiB, four fetches in flight, and a ten-second timeout per request. It records the
HTTP status, the final URL, a SHA-256 of the bytes read, and whether the title appears in a
textual body; at skepticism 8 and above it also asks Crossref whether a DOI has been retracted.
`reachable` means the page exists, not that its claims are correct, and the packet says so.
Scouted records that are unreachable or retracted are dropped; user-supplied records are kept
and labelled.

At skepticism 5 and above one seeded council provider grades the records in batches of twenty for
reliability (1–10), replication status, and concerns, without seeing who proposed them. The
per-record `scoutProvider` field is private and is stripped from every public snapshot, report,
and prompt; scout names themselves are configuration and may appear in warnings.

The verified records are appended to the sealed packet as a sources appendix that may take at
most a quarter of the context budget; the manifest seals the whole packet, and quote verification
still runs only against the file section. Hypotheses may cite a record with evidence basis
`source` and its id, which the evidence check verifies against the record list. The report gains
a "Sources" section listing every record with its verification status and critique grade.

Novelty raises how many sources each scout is asked for (five at the default) and adds a second
scouting round at 8 and above. Skepticism selects the verification mode (`none` at 2 and below,
`fetch` in between, `fetch-plus-retraction` at 8 and above), switches the critique on at 5, and at
8 and above stops counting a source graded below 4 for reliability, or contested, as verified
evidence. `--web off` disables scouting and every URL fetch; scouts stay off the council.

## Product contract

Interactive mode and script commands share the same application service. Plain chat does not start
or mutate council work. Session chat is grounded in persisted candidates, reviews, and attacks.

The interactive shell is a presentation layer over that service. Its report catalog (`/reports`,
`/open`, `/tag`, `/summarize`) stores titles, tags, and summaries beside the sessions and never
provider identities. `/duck`, `@name` mentions, and `/ask-all` send plain chat to one, several, or
every configured provider with separate conversation histories; chat is conversational and never
feeds a council stage. The context basket (`/context`, `/repo`, `@path` mentions) collects files
and pasted snippets, materialises snippets as files under the session home so the same manifest
and secret-path rules apply, and previews and confirms a packet before it leaves the machine.
Pasted text is not secret-filtered.

Runs are foreground-owned. Ctrl-C closes the live Rubber Duck MCP subprocess and leaves completed
stage checkpoints on disk, subject to the vendor-grandchild limitation above. There is no detached
mode until the project has a durable worker, ownership, and heartbeat semantics.

The standalone MCP server exposes the same workflow as seven normal foreground tools: four for
the council and three for research proposals. Persistent session data—not an in-memory MCP task
handle—is authoritative. Executing a handoff is a CLI-only action.

The Markdown report remains the canonical artifact. `hc report --html` (and `/report html` in the
shell) renders it as a styled, self-contained HTML document—a CLI presentation concern with all
report text HTML-escaped—and `--open` launches it in the default browser.

## Proposal workflow

`hc propose` runs a second workflow over the same providers and store, in `src/research/proposal/`:

```text
topic + context (optionally a council session's context and ranked findings)
            ↓
sealed interview: each provider proposes questions independently → merged, deduplicated, unlabelled
            ↓
answers (free text, skip, another round, or finish early)
            ↓
independent drafting (sealed, like generation)
            ↓
blinded critique: one non-author critic per draft → ranked drafts
            ↓
synthesis into one proposal (or `--pick` one draft)
            ↓
handoff bundle → optional live executor
```

Providers never see one another's questions before the merge, and the merged list shows how many
providers asked each question without saying who. Every draft must give each experiment a
method, metrics, a success criterion, and a kill criterion a stranger could apply. The synthesis
prompt carries the public critiques and must keep dissenting designs as named alternatives
rather than discard them. Call budget per proposal: interview at most providers times rounds,
drafts one per provider, critiques one per draft, synthesis one. Author, critic, and synthesizer
identities never reach the public snapshot, the report, or the prompts.

A handoff writes `handoff/X-###/` under the proposal session with the proposal, the interview
transcript, the context manifest, and the executor prompt. The prompt names the repository,
tells the executor to carry the steps out in order without asking questions, to keep its scripts
and results under `hc-results/<RP-id>/` inside the repository, to record every assumption, to
apply each kill criterion honestly, and to end with a report between fixed
`===== HC EXECUTOR REPORT BEGIN/END =====` delimiters. The harness extracts that block into
`executor-report.md` next to the bundle and records it on the handoff.

## Executor safety

`src/executor/` launches the vendor CLI directly with the repository the user confirmed as its
working directory; the session home is refused as a cwd. Built-in profiles (`claude`, `codex`,
`agy`, `grok`) run in full-auto mode by default, which means no approval prompts and permission
to modify or delete files under the repository; `HYPOTHESIS_COUNCIL_EXECUTOR_MODE=sandboxed`
switches each CLI to its restricted mode instead. Before spawning, the CLI refuses a dirty git
working tree unless `--allow-dirty`, prints the executor, mode, model, exact command, cwd, and
branch, and asks for a y/N confirmation (`--yes` for scripts). Output streams to `executor.log`
in the bundle, Ctrl-C or the timeout (`HYPOTHESIS_COUNCIL_EXECUTOR_TIMEOUT_MS`, two hours by
default) kills the whole process tree, and the handoff status is persisted before the spawn and
after the exit. Custom executors are declared through `HYPOTHESIS_COUNCIL_EXECUTOR_<NAME>_COMMAND`,
`_ARGS`, `_PROMPT_DELIVERY`, and `_MODEL_FLAG`.

## Persistence and context

Slice 1 uses atomic, permission-restricted JSON checkpoints and separate raw/parsed artifacts. This
supports one foreground writer and concurrent readers. SQLite migrations, WAL, idempotency keys,
and exactly-once updates are required before detached or simultaneous workers.

The CLI treats the current directory (or `--repo`) as the repository and includes supported text
and code files by default. `--context` narrows that selection—it accepts files, directories, and
deterministic glob patterns (`*` and `?` within a segment, `**` across directories; denied
directories are never traversed)—and `--markdown-only` limits it to Markdown/MDX. Ordering and
truncation are deterministic; symlinks, generated directories, common credential paths, and local
settings files are denied; and a manifest records hashes, omissions, and truncation. A requested
path or pattern that selects no eligible files is recorded in the manifest, warned about in the
run preview, and preserved as a session warning so silent context loss cannot go unnoticed.

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
- Hypothesis Council MCP tool registration through an in-memory transport;
- settings schema validation, file round-trips, and flag > environment > file precedence;
- dial policy formulas and their effect on prompts, extra calls, and ranking rules;
- model ranking over fixture catalogs, discovery through fake catalog files and fake listing
  commands, cache expiry, and the doctor's fallback reporting;
- shell commands through the registry with fake IO: the report catalog and tags, provider
  mentions and multi-provider chat, the context basket, completion, and settings edits;
- the proposal domain (question merging, sealed interview, blind critique, synthesis, resume)
  and the CLI interview loop driven by a scripted line source;
- executor profiles as argument tables and the runner against fake scripts (report extraction,
  non-zero exit, abort within the timeout, log and cwd);
- sources parsing, the fetch verifier against a fake fetch (redirects, blocked hosts, byte cap,
  Crossref retractions, cancellation), the sourcing gateway end to end, and prompts that hide
  scout identities.

Workflow tests use a scripted provider to verify independence, repair, label removal, balanced
assignment, falsification, artifacts, reporting, and grounded follow-up answers. No normal test
contacts a live provider.

## Later slices

1. Replace file storage with versioned SQLite, WAL, and idempotent stage recovery.
2. Add multiple blinded reviews, explicit tie policy, call budgets, and stage timeouts.
3. Add position-balanced pairwise evaluation with deterministic Elo application order.
4. Add immutable evolution lineage and a synthesizer that explains but cannot override ranking.
5. Add an explicit experiment-feedback loop (`hc observe H-001 --outcome ...`) that triggers a
   bounded revision round and preserves unresolved dissent in every report.
6. Add a prediction ledger: pre-registered predictions timestamped per session, scored when
   outcomes arrive, accumulating an empirical calibration record per provider and per hypothesis
   class across sessions.
7. Add an opt-in sandboxed experiment runner for mechanically testable claims about a code
   repository: a falsification-stage provider writes a test script, the harness runs it against a
   read-only copy in the session directory, and the real output attaches to the attack record.
8. Add council decorrelation levers: deterministic perspective seeding (recorded assigned
   stances), an anomaly-first mode that collects poorly explained observations before generating
   explanations, and semantic (not just lexical) crowding measurement.
9. Web retrieval today exists only in the sources stage: scouts propose records before
   generation, the harness verifies them mechanically, and generators still never retrieve.
   Extending retrieval to the falsification stage — attackers searching for disconfirming
   evidence — remains a later slice, so literature acts as adversary, not oracle.

Only then should the project claim conformance with the original specification’s complete MVP.
