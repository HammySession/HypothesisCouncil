# Hypothesis Council

Hypothesis Council is an inspectable hypothesis-generation workflow built on
[MCP Rubber Duck](https://github.com/nesquikm/mcp-rubber-duck). It independently generates
hypotheses with configured providers, removes explicit authorship labels during review, attacks
the strongest candidates, and persists the complete session locally.

The repository does not copy or fork Rubber Duck. It pins `mcp-rubber-duck@1.20.5` as a runtime
dependency and launches its published MCP server in a subprocess for each active session.
Hypothesis Council communicates only through Rubber Duck's public `list_ducks` and `ask_duck`
tools.

## First working slice

The current implementation provides:

- an interactive rubber-duck shell and scriptable commands;
- foreground research runs with visible progress;
- explicit, bounded shared context packets with common secret paths denied;
- independent multi-provider generation with a sealed generation barrier;
- tolerant JSON extraction and one repair attempt;
- deterministic lexical deduplication;
- balanced, authorship-label-blinded reviews;
- adversarial falsification of finalists;
- atomic local checkpoints, raw/parsed artifacts, and Markdown/JSON reports;
- read-only, session-grounded follow-up questions;
- four standalone Hypothesis Council MCP tools.

Pairwise Elo, evolution, exactly-once recovery, and SQLite migrations remain later slices.

## Setup

Prerequisites are Node.js 20+ and at least one Rubber Duck provider. Installing this project also
installs the pinned Rubber Duck package:

```bash
npm ci
npm run build
npm link
```

Configure providers through exported environment variables or
`~/.mcp-rubber-duck/config.json`. For example:

```bash
export CLI_CLAUDE_ENABLED=true
export CLI_CODEX_ENABLED=true
export CLI_GEMINI_ENABLED=true
export CLI_GROK_ENABLED=true
```

Vendor CLIs must already be installed and authenticated. Rubber Duck also supports HTTP and custom
providers through its normal configuration.

## Interactive use

```bash
npm run cli
```

```text
home> /run Why does validation improve while deployment performance degrades?
RC-...> /status
RC-...> /candidates
RC-...> /show H-001
RC-...> Which experiment best separates H-001 from H-003?
RC-...> /report
```

Plain text is conversational. Council work starts only through an explicit command.

## Scriptable use

```bash
# Analyze the repository in the current directory with the default research goal.
cd /path/to/stock_embeddings
hc run

# Or point at another repository and skip the interactive privacy confirmation.
hc run "Find likely sources of training/serving skew" \
  --repo /path/to/stock_embeddings \
  --yes

# Send only Markdown and MDX files.
hc run --repo /path/to/stock_embeddings --markdown-only --yes

hc status
hc candidates
hc show H-001
hc ask "Which evidence would most change the ranking?"
hc report
```

`hc run` uses the current directory as repository context and supplies a useful default research
goal when none is written. `--context PATH` can be repeated to narrow the repository selection;
paths are resolved relative to `--repo`. Context is sent to external model providers. The CLI
previews included, omitted, and denied paths; asks for confirmation in a terminal; and requires
`--yes` when stdin is not interactive.

The context budget is automatic. Each selected provider gets the same sealed packet, so the packet
uses the smallest usable model window in the council after reserving prompt and output tokens.
`--max-context-bytes` is an optional lower cap, not a required size. For a provider whose exact
model is unavailable, set an explicit token window as shown below. Token capacity is converted to
a byte budget with a three-UTF-8-bytes-per-token estimate and the final packet byte count is
enforced exactly.

```bash
export HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX=1050000
```

Large repositories receive a deterministic path manifest and fair per-file excerpts before spare
capacity is allocated to high-priority project instructions, root metadata, documentation, source,
and tests. Common credential paths, symlinks, generated directories, and local settings files are
denied, but the preview remains the final privacy check.

### Stock embeddings four-model preset

The checked-in runner configures Grok 4.6 at `xhigh`, Gemini 3.1 Pro High through AGY, Claude
Fable 5, and GPT-5.6 Sol at `xhigh`. It requires all four providers and sends only Markdown/MDX
context from the sibling `stock_embeddings` repository:

```bash
npm run build
npm run stock:markdown
```

Review the context preview and confirm it, or pass `--yes` for a non-interactive run:

```bash
npm run stock:markdown -- --yes
```

If the repository is elsewhere, override its location without editing the script:

```bash
STOCK_EMBEDDINGS_REPO=/absolute/path/to/stock_embeddings \
  npm run stock:markdown
```

The script checks that `agy`, `claude`, `codex`, and `grok` are installed. AGY must already be
authenticated, and Grok requires `grok login`. Each provider subprocess has a 15-minute timeout;
the MCP request layer adds one minute of shutdown headroom so high-effort Codex and Grok calls are
not cut off by Rubber Duck's shorter custom-provider default. Because AGY and Grok currently accept the full
prompt through a command-line flag, their transport-safe limit constrains the shared council packet
to 96 KiB. Every eligible Markdown file is represented when framing permits, but larger files are
deterministically excerpted to fit that shared limit.

Sessions default to `~/.mcp-rubber-duck/hypothesis-council`. Override this with
`HYPOTHESIS_COUNCIL_HOME`.

## MCP server

The `hypothesis-council-mcp` binary exposes the project tools over stdio:

- `duck_hypothesis_council`
- `duck_hypothesis_status`
- `duck_hypothesis_report`
- `duck_hypothesis_ask`

It is a separate MCP server that launches the installed Rubber Duck server internally when a tool
needs a model provider.

## Development

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Tests use fake clients and in-memory MCP transports. They never call live model providers.

See [the reviewed Slice 1 design](./docs/hypothesis-council.md),
[the MCP tool surface](./docs/tools.md), and
[the original long-term specification](./LLM_HYPOTHESIS_COUNCIL_CODEX_SPEC.md).

## Privacy and scientific limits

- “Blinded” means explicit provider labels are removed; writing style is not normalized.
- Secret-path filtering cannot detect every secret embedded in an ordinary file.
- Model review is structured debate, not independent experimental validation.
- Review aggregates are prioritization signals, not probabilities of truth.
- Runs are foreground-owned; exiting interrupts work instead of pretending a daemon exists.
- The wrapper adapts the default Rubber Duck 1.20.5 Codex and Claude CLI presets to stdin so large
  packets do not overflow the operating system's argument limit. Explicit CLI argument overrides
  are preserved and may therefore receive a smaller transport-safe budget.
- Cancelling closes the session-scoped Rubber Duck MCP subprocess. Rubber Duck 1.20.5 does not
  guarantee termination of an already-spawned vendor CLI grandchild; it may continue until its
  configured provider timeout.
