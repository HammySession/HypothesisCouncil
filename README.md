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
- `hc doctor` and ready-made council presets for setup without hand-written environment;
- foreground research runs with a live progress line, a dry-run mode, and an end-of-run summary;
- explicit, bounded shared context packets with common secret paths denied;
- independent multi-provider generation with a sealed generation barrier;
- tolerant JSON extraction and one repair attempt;
- mandatory differs-from-consensus statements and evidence provenance tags, with context quotes
  verified mechanically against the sealed packet;
- deterministic lexical deduplication and cross-provider consensus-crowding measurement;
- balanced, authorship-label-blinded reviews that grade each declared falsifier; an untestable
  falsifier gates a hypothesis below every testable one;
- adversarial falsification of finalists;
- atomic local checkpoints, raw/parsed artifacts, and Markdown/JSON/HTML reports;
- read-only, session-grounded follow-up questions;
- four standalone Hypothesis Council MCP tools.

Pairwise Elo, evolution, exactly-once recovery, and SQLite migrations remain later slices.

## Epistemic guardrails

LLM councils fail scientifically in a predictable way: they restate the literature and treat
agreement as confirmation. The workflow counters this structurally rather than by prompting
alone:

- Every hypothesis must say what it predicts that the consensus explanation does not; restated
  consensus is recall, not a hypothesis.
- Supporting claims are tagged `context`, `general-knowledge`, or `speculation`. Context quotes
  are verified mechanically against the sealed packet — never by a model — so remembered
  literature cannot pose as grounded evidence, and reviewers are told not to accept
  general-knowledge claims on authority.
- Reviewers grade each declared falsifier `concrete`, `vague`, or `untestable`; an untestable
  kill criterion ranks the hypothesis below every testable candidate.
- Cross-provider convergence is measured and reported as consensus crowding — a caution, not a
  confidence signal — because models trained on the same literature agreeing is not independent
  replication. Crowding never raises a candidate's rank.

Reports show novelty beside the review aggregate so speculative-but-testable ideas stay visible
next to plausible-but-boring ones.

## Setup

Prerequisites are Node.js 20+ and at least one Rubber Duck provider. Installing this project also
installs the pinned Rubber Duck package:

```bash
npm ci
npm run build
npm link
```

Vendor CLIs (`claude`, `codex`, `grok`, `agy`, ...) must already be installed and authenticated.
Then check what the council can see:

```bash
hc doctor                    # providers, models, context windows, prompt transport, CLIs on PATH
hc doctor --probe            # also send a one-line prompt to every provider and time the reply
hc presets                   # ready-made councils
hc doctor --preset frontier  # check a preset before spending a run on it
```

`hc doctor` exits non-zero when it finds a problem, so it can gate scripts.

## Quick start

```bash
cd /path/to/your-repository
hc run --preset quick --dry-run          # preview context, budget, and planned calls; sends nothing
hc run --preset quick --yes              # two-provider council over the current repository
hc run --preset frontier --markdown-only --yes --out ./HYPOTHESES.md
```

A preset configures providers, models, reasoning effort, timeouts, and prompt transport in the
current process before Rubber Duck starts; nothing is written to your shell profile or to
`~/.mcp-rubber-duck/config.json`. Explicit flags such as `--providers` and `--min-providers`
override the preset's defaults, and `HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS` is respected.

| Preset     | Council                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| `frontier` | Grok 4.6 (xhigh), Gemini 3.1 Pro High via AGY, Claude Fable 5 (1M), GPT-5.6 Sol (xhigh); all four required |
| `quick`    | Claude Code and Codex with their default models                                       |

Providers can still be configured by hand through exported environment variables or
`~/.mcp-rubber-duck/config.json`, for example `export CLI_CLAUDE_ENABLED=true`. Rubber Duck also
supports HTTP and custom providers through its normal configuration; `hc doctor` shows whatever it
finds.

## Interactive use

```bash
npm run cli
```

```text
home> /preset frontier
home · frontier> /run Why does validation improve while deployment performance degrades?
RC-...> /status
RC-...> /candidates
RC-...> /show 1
RC-...> Which experiment best separates H-001 from H-003?
RC-...> /report
RC-...> /report html     # render the report as HTML and open it in the browser
```

Plain text is conversational. Council work starts only through an explicit command. Command
history persists across shells in `<session home>/shell-history`.

## Scriptable use

```bash
# Analyze the repository in the current directory with the default research goal.
cd /path/to/stock_embeddings
hc run

# Or point at another repository and skip the interactive privacy confirmation.
hc run "Find likely sources of training/serving skew" \
  --repo /path/to/stock_embeddings \
  --yes

# Send only Markdown and MDX files, and copy the report next to the code.
hc run --repo /path/to/stock_embeddings --markdown-only --yes --out ./HYPOTHESES.md

# Narrow the context with files, directories, and glob patterns (resolved against --repo).
hc run --context src --context "docs/**/*.md" --yes
hc run "Why is startup slow?" --context "src/**/*.ts" --context package.json --yes

hc status
hc candidates
hc show H-001            # H1 and 1 work too
hc ask "Which evidence would most change the ranking?"
hc report                # --json for the JSON report, --out PATH to copy it
hc report --html         # styled, self-contained HTML next to the session artifacts
hc report --html --open  # ... and open it in the default browser
```

`hc run` uses the current directory as repository context and supplies a useful default research
goal when none is written. `--context` can be repeated to narrow the repository selection; it
accepts files, directories, and deterministic glob patterns (`*` and `?` within a path segment,
`**` across directories), all resolved relative to `--repo`. A path or pattern that selects no
eligible files is warned about in the run preview and recorded in the session, so silent context
loss cannot go unnoticed. Context is sent to external model providers. The CLI
previews included, omitted, and denied paths together with the planned number of provider calls;
asks for confirmation in a terminal; and requires `--yes` when stdin is not interactive.
`--dry-run` prints the same preview and exits without creating a session. `--json` prints the
public session snapshot instead of the summary.

While a run is in progress the terminal shows one live line per stage with the providers (during
generation) or candidate ids (during review and falsification) still in flight and the elapsed
time; set `HYPOTHESIS_COUNCIL_PLAIN_PROGRESS=true` for plain line-per-event output. When the run
finishes the CLI prints the top candidates with their review verdicts, the report path, and
suggested next commands.

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
denied, but the preview remains the final privacy check. Manifest paths always use `/`
separators, so session artifacts are identical across operating systems.

### Prompt transport and the stdin shim

A vendor CLI that only accepts the prompt as a command-line argument caps the shared packet at the
operating system's argument limit: 96 KiB on Linux and macOS, and 24 KiB on Windows, where
`CreateProcess` caps the whole command line at 32,767 characters. The wrapper adapts the default
Rubber Duck Codex and Claude presets to stdin automatically. For CLIs without a stdin prompt
option the `frontier` preset launches a small shim (`dist/rubber-duck/stdin-shim.js`) that
receives the prompt from Rubber Duck over stdin and forwards it through a transport the CLI does
support: a temporary `--prompt-file` for Grok, and a `stream-json` message for AGY. The prompt
file is written with owner-only permissions inside the session directory and removed as soon as
the CLI exits. `hc doctor` reports each provider's transport and the resulting cap.

### Stock embeddings four-model run

```bash
npm run build
npm run stock:markdown -- --yes
```

The runner applies the `frontier` preset and sends only Markdown/MDX context from the sibling
`stock_embeddings` repository. It runs the same way from PowerShell, cmd, and POSIX shells. If the
repository is elsewhere, point at it without editing the script:

```bash
STOCK_EMBEDDINGS_REPO=/absolute/path/to/stock_embeddings npm run stock:markdown
```

Each provider subprocess has a 15-minute timeout; the MCP request layer adds one minute of shutdown
headroom so high-effort Codex and Grok calls are not cut off by Rubber Duck's shorter
custom-provider default.

Sessions default to `~/.mcp-rubber-duck/hypothesis-council`. Override this with
`HYPOTHESIS_COUNCIL_HOME`.

## MCP server

The `hypothesis-council-mcp` binary exposes the project tools over stdio:

- `duck_hypothesis_council`
- `duck_hypothesis_status`
- `duck_hypothesis_report`
- `duck_hypothesis_ask`

It is a separate MCP server that launches the installed Rubber Duck server internally when a tool
needs a model provider. Presets are a CLI feature; configure providers for the MCP server through
Rubber Duck's environment variables or config file.

## Development

```bash
npm run check   # typecheck, lint, tests, build: the merge gate
```

or the individual steps:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Tests use fake clients and in-memory MCP transports. They never call live model providers. Two
package-contract tests that shadow the real `codex` and `claude` executables with fake scripts are
skipped on Windows, where Rubber Duck's shell-less spawn cannot be intercepted that way; the
custom-provider contract test still runs the real package there.

See [the reviewed Slice 1 design](./docs/hypothesis-council.md),
[the MCP tool surface](./docs/tools.md), and
[the original long-term specification](./LLM_HYPOTHESIS_COUNCIL_CODEX_SPEC.md).

## Privacy and scientific limits

- “Blinded” means explicit provider labels are removed; writing style is not normalized.
- Secret-path filtering cannot detect every secret embedded in an ordinary file.
- Model review is structured debate, not independent experimental validation.
- Evidence verification confirms only that a quote appears in the shared packet; claims tagged
  general knowledge remain unverified literature memory.
- Review aggregates are prioritization signals, not probabilities of truth.
- Runs are foreground-owned; exiting interrupts work instead of pretending a daemon exists.
- Explicit Rubber Duck CLI argument overrides are preserved and may therefore receive a smaller
  transport-safe budget than the presets.
- Cancelling closes the session-scoped Rubber Duck MCP subprocess. Rubber Duck 1.20.5 does not
  guarantee termination of an already-spawned vendor CLI grandchild; it may continue until its
  configured provider timeout.
