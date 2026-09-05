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
- a settings file with flag > environment > file > default precedence, and novelty and
  skepticism dials that every report records;
- automatic latest-model selection per vendor CLI, with pinned fallbacks and `hc models`;
- an interactive shell with a report catalog (tags, titles, summaries, an HTML gallery), chat
  with one, several, or all providers, and a context basket for files and pasted snippets;
- a research-proposal mode: a sealed council interview, independent drafts, blind critiques, one
  merged proposal, and a handoff bundle an executor CLI can carry out in your repository;
- a sources stage: a supplied sources file plus web scouts, verified by fetching, graded blind,
  and cited from the sealed packet;
- seven standalone Hypothesis Council MCP tools.

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
  replication. Crowding never raises a candidate's rank; above the default novelty level it
  lowers one.
- Two dials, novelty and skepticism, tune how far the council strays from the dominant
  explanation and how much scrutiny evidence receives. Every run records its dial levels and the
  ranking rules they produced under "Session configuration" in the report.

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

| Preset     | Council                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontier` | Grok 4.6 (xhigh), Gemini 3.8 Flash High via AGY, Claude Fable 5 (1M), GPT-5.6 Sol (xhigh); all four required, plus Claude, Codex, and Grok web scouts |
| `quick`    | Claude Code and Codex with their default models                                                                                                       |

`frontier` resolves each slot to the newest model its vendor CLI lists (see "Model selection");
the table shows the pinned fallbacks, and `HYPOTHESIS_COUNCIL_MODEL_POLICY=pinned` or
`hc settings set modelPolicy pinned` reproduces them exactly. Its scouts serve the sources stage
only (see "Web scouting").

Providers can still be configured by hand through exported environment variables or
`~/.mcp-rubber-duck/config.json`, for example `export CLI_CLAUDE_ENABLED=true`. Rubber Duck also
supports HTTP and custom providers through its normal configuration; `hc doctor` shows whatever it
finds.

## Interactive use

```bash
hc            # or: npm run cli
```

```text
home> /preset frontier
home · frontier> /context add src "docs/**/*.md"
home · frontier · ctx:2> @claude what does the training loop do?
home · frontier · ctx:2> /run Why does validation improve while deployment performance degrades?
RC-... · frontier> /candidates
RC-... · frontier> /show 1
RC-... · frontier> Which experiment best separates H-001 from H-003?
RC-... · frontier> /report html
RC-... · frontier> /tag add skew,serving
RC-... · frontier> /reports --tag skew
```

The prompt shows the selected session (or `home`), the ducks plain text goes to, the preset,
`N8/S5` whenever a dial is off its default, and `ctx:N` while the context basket holds items.
Plain text is conversational: with no session selected it asks the selected duck (or every duck
after `/duck all`), and with a session selected it asks a question grounded in that session's
persisted candidates, reviews, and attacks without touching the rankings. Council work starts
only through an explicit command. Tab completes commands, session ids, provider names after
`/duck` and `@`, and paths after `@` and `/context add`. Command history persists across shells
in `<session home>/shell-history`.

| Command                                                                                    | What it does                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `/run [goal] [flags]`                                                                      | Start a council run; the basket, `/repo`, preset, and dials are its defaults and `hc run` flags override them |
| `/status`, `/candidates`, `/show H-001`                                                    | Inspect the selected session                                                                                  |
| `/report [html]`                                                                           | Print the report, or render it as HTML and open it                                                            |
| `/reports [TEXT] [--tag TAG] [--json] [--html [--open]]`                                   | Browse saved reports by text or tag; `--html` writes the gallery                                              |
| `/open N\|SESSION\|index`                                                                  | Open one report, or the gallery, in the browser                                                               |
| `/tag [SESSION] add a,b \| rm a \| title "…" \| clear \| show`                             | Tag or retitle a report for the catalog                                                                       |
| `/summarize [SESSION]`                                                                     | Ask one provider for a short summary of the public report; shown in `/reports` and the gallery                |
| `/sessions`, `/use SESSION`                                                                | List sessions; select a council (`RC-`) or proposal (`RP-`) session                                           |
| `/duck NAME[,NAME] \| all \| auto`, `@name …`, `/ask-all QUESTION`, `/clear [PROVIDER]`    | Choose which ducks plain text goes to, mention one inline, ask every duck at once, forget a chat history      |
| `/context …`, `/repo [PATH]`                                                               | Manage the context basket and the repository root (see below)                                                 |
| `/settings [json] [providers]`, `/set KEY VALUE`, `/unset KEY`                             | Show effective settings, the models in use, and the configured ducks; edit the settings file                  |
| `/preset NAME`, `/presets`, `/models [refresh]`, `/doctor [--probe]`                       | Choose a council; list presets; show the resolved models; check providers                                     |
| `/propose "<topic>" [flags]`, `/questions`, `/answer`, `/next`, `/done`, `/draft`, `/pick` | Research proposals (see below); `/proposal`, `/proposals`, and `/resume` inspect and continue them            |
| `/help`, `/exit`                                                                           | List every command; leave the shell                                                                           |

### Context basket

```text
home> /repo /path/to/project
home> /context add src "docs/**/*.md"
home · ctx:2> /context add-text NOTES        # paste, then a line with only "." ends the block
home · ctx:3> /context show
home · ctx:3> @claude @src/train.py why is the loss clipped?
home · ctx:4> /context rm NOTES
home · ctx:3> /context markdown on
home · ctx:3> /context clear
```

The basket holds files, globs, and pasted snippets. `@path` in a chat message adds that path for
the conversation. Snippets are saved as files under `<session home>/basket/` so the ordinary
context builder, its denial rules, and its byte budget apply to them; the pasted text itself is
not secret-filtered, so read it before pasting. The first message that carries a packet previews
the included and denied paths and asks once per distinct packet; when stdin is not interactive
the shell refuses and tells you to empty the basket. `/run` uses the basket as its default
`--context`, `/repo` as `--repo`, and `/context markdown on` as `--markdown-only`.

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
hc reports --tag skew    # catalog of saved reports; --html [--open] writes the gallery
hc open 1                # open one report (or `index`, the gallery) in the browser
hc tag add skew,serving  # tag or retitle a report: add | rm | title | clear | show
hc sessions
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
the CLI exits. The preset also passes `--disable-web-search` to Grok, which searches the web by
default, so every council member answers from the sealed context packet alone. `hc doctor`
reports each provider's transport and the resulting cap.

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

## Settings

Every run resolves its settings with the precedence **command flag > environment variable >
settings file > default**. `hc settings` prints each value with its origin:

```bash
hc settings                       # table of effective values and where each comes from
hc settings --json
hc settings set novelty high      # write <session home>/settings.json (mode 0600)
hc settings set default-preset frontier
hc settings unset novelty
hc settings path | reset | help
```

| Key              | Flag              | Environment variable              | Meaning                                          |
| ---------------- | ----------------- | --------------------------------- | ------------------------------------------------ |
| `novelty`        | `--novelty`       | `HYPOTHESIS_COUNCIL_NOVELTY`      | 0–10 or `low`/`medium`/`high`; default 5         |
| `skepticism`     | `--skepticism`    | `HYPOTHESIS_COUNCIL_SKEPTICISM`   | 0–10 or `low`/`medium`/`high`; default 5         |
| `defaultPreset`  | `--preset`        | `HYPOTHESIS_COUNCIL_PRESET`       | council preset used when a run names none        |
| `defaultContext` | `--context`       |                                   | context paths used when a run names none         |
| `markdownOnly`   | `--markdown-only` |                                   | send only Markdown and MDX files by default      |
| `modelPolicy`    |                   | `HYPOTHESIS_COUNCIL_MODEL_POLICY` | `latest` (auto-select newest models) or `pinned` |
| `sources.file`   | `--sources`       | `HYPOTHESIS_COUNCIL_SOURCES`      | default sources file (sources stage)             |
| `sources.scouts` | `--scouts`        | `HYPOTHESIS_COUNCIL_SCOUTS`       | scout providers for web scouting (sources stage) |
| `sources.web`    | `--web`           | `HYPOTHESIS_COUNCIL_WEB`          | `auto`, `on`, or `off`                           |

The settings file is validated strictly; a typo fails loudly with a pointer to `hc settings
reset` rather than silently falling back to a default. When an environment variable shadows a
value you just set, the command warns.

## Model selection

Presets with model slots (today `frontier`) pick the newest model per vendor automatically before
Rubber Duck starts. Discovery reads the vendor CLI's own catalog file where one exists and
otherwise runs its read-only listing command; nothing is written to vendor configuration and no
credential is ever copied into the council's cache:

| Slot     | Vendor CLI | Discovery source                                                  | Pinned fallback         |
| -------- | ---------- | ----------------------------------------------------------------- | ----------------------- |
| `grok`   | `grok`     | `~/.grok/models_cache.json` (ids and windows only), `grok models` | `grok-4.6`              |
| `agy`    | `agy`      | `agy models`, Gemini ids only                                     | `gemini-3.8-flash-high` |
| `claude` | `claude`   | `~/.claude.json` model cache and `~/.claude/settings.json`        | `claude-fable-5[1m]`    |
| `codex`  | `codex`    | `~/.codex/models_cache.json` (`CODEX_HOME`), `codex debug models` | `gpt-5.6-sol`           |

Ranking drops hidden, superseded, and foreign-vendor ids; skips `mini`, `nano`, `lite`, `spark`,
preview, experimental, and dated snapshot ids unless nothing else remains; then compares the
family (Claude `fable > opus > sonnet > haiku`), the numeric version, a `[1m]` context profile,
the reasoning effort, and the vendor's own priority. Gemini ranks the version first, so
`gemini-3.8-flash-high` beats `gemini-3.1-pro-high`; set
`HYPOTHESIS_COUNCIL_MODEL_FAMILY_GEMINI=pro` to prefer the pro tier. A context window the vendor
catalog reports (Codex's 272,000 tokens, Grok's 500,000) is trusted as-is; when a catalog reports
none, the window is derived from the model id.

Precedence: `--model KEY=ID` or a `CLI_*_DEFAULT_MODEL` variable set before the run, then the
`pinned` model policy, then the discovered latest, then the preset pin, then a curated table.
Discovery results are cached for 24 hours in `<session home>/models-cache.json`
(`HYPOTHESIS_COUNCIL_MODEL_CACHE_TTL_MS`); listing commands time out after 15 seconds
(`HYPOTHESIS_COUNCIL_MODEL_DISCOVERY_TIMEOUT_MS`). A failed discovery falls back to the stale
cache, then to the pin, and `hc doctor` says so; it never blocks a run.

```bash
hc models                           # one line per slot: model, origin, window, source
hc models --refresh --json          # ask the vendor CLIs again
hc run --preset frontier --model codex=gpt-5.5 "goal"
hc settings set modelPolicy pinned  # reproduce the preset pins on every run
```

## Novelty and skepticism dials

`--novelty` and `--skepticism` accept 0–10 or `low` (2), `medium` (5), `high` (8). Level 5/5
reproduces the pre-dial council exactly. The dials never change the independence barrier, the
blinding, or the persisted evidence; they change prompts, the extra calls the council makes, and
the ranking rules, all of which the report records.

| Level | Novelty                                                                                                                          | Skepticism                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0–2   | Prefer the most plausible mechanisms; novelty weighs less in the aggregate                                                       | Well-known results may be cited without proof; no source verification                                                    |
| 5     | Balanced (the previous behaviour)                                                                                                | Balanced (the previous behaviour)                                                                                        |
| 6–7   | Novelty weighs more; consensus-crowded candidates lose points                                                                    | Candidates without verified context evidence lose points; the report lists weakly supported claims                       |
| 8–10  | One extra sealed "out-of-the-box" generation call per provider; at least one hypothesis must contradict the dominant explanation | Two independent adversarial rounds per finalist with different attackers; unverified candidates rank below verified ones |

Exact formulas live in `src/research/dials.ts`; `hc run --dry-run` shows the resulting call
budget before anything is sent.

## Research proposals

`hc propose` turns a topic into one executable research proposal. The council first interviews
you: every provider independently proposes clarifying questions, the questions are merged without
author labels, and you answer, skip, ask for another round, or finish early. The providers then
draft independently, each draft is critiqued blind by a non-author, and the ranked drafts are
merged into one proposal that keeps dissenting designs as named alternatives.

```bash
hc propose "Does serving skew explain the validation gap?" --context src --from RC-...
hc propose questions                     # open questions, with how many providers asked each
hc propose answer Q-001 "Daily batch inference over ~2M rows" --skip Q-002
hc propose next                          # another interview round
hc propose done                          # finish the interview, then draft, critique, and merge
hc propose show D-001                    # one draft with its blind critique
hc propose report --json                 # transcript, ranked drafts, and the proposal
hc propose ask "Which step would you drop first?"
hc propose handoff --to claude --repo /path/to/project             # write the bundle only
hc propose handoff --to codex --repo /path/to/project --run --yes  # ... and run the executor
```

`--rounds N` and `--max-questions N` bound the interview, `--no-interview` drafts at once, and
`--answers FILE` supplies a JSON object of question id to answer (`null` skips). The interview is
sealed by default: each provider sees only its own questions; `--visible` lets later rounds see
everyone's merged questions and answers. `--pick` lets you choose one draft instead of merging.
`--from RC-...` reuses a council session's context selection and ranked findings. The same
providers, presets, dials, and privacy preview apply as for `hc run`. In the shell, `/propose`
starts a proposal, `/use RP-...` selects one, `/questions`, `/answer`, `/next`, `/done`,
`/draft`, and `/pick D-002` drive it, `/proposal [drafts | D-001 | json]` and `/proposals`
inspect it, and plain text asks a question grounded in it.

### Running the executor

`hc propose handoff` writes `handoff/X-###/` under the proposal session: `proposal.md`,
`transcript.md`, `context-manifest.json`, and `executor-prompt.md` (`--print` shows the prompt).
The prompt tells the executor to carry the steps out in order without asking questions, to keep
scripts and results under `hc-results/<RP-id>/` inside the repository, to apply each kill
criterion honestly, and to end with a report between fixed delimiters. With `--run` the CLI
launches one executor CLI (`claude`, `codex`, `agy`, `grok`, or a custom name) in the repository,
streams its output to `executor.log`, and saves the delimited report as `executor-report.md`.

The executor runs in full-auto mode by default: no approval prompts, and it may create, modify,
or delete files under the repository. The CLI therefore refuses the session home as a
repository, refuses a dirty git working tree unless `--allow-dirty`, prints the executor, mode,
model, exact command, cwd, and branch, and asks for confirmation (`--yes` for scripts). Ctrl-C or
the timeout (`--timeout-ms`, two hours by default) kills the whole process tree. The executor's
model comes from the same latest-model resolution as the presets; `--model ID` pins it.

| Variable                                                                                 | Meaning                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `HYPOTHESIS_COUNCIL_EXECUTOR_MODE`                                                       | `full-auto` (default) or `sandboxed` (Claude `--permission-mode acceptEdits`, Codex `--full-auto`, agy `--sandbox`) |
| `HYPOTHESIS_COUNCIL_EXECUTOR_TIMEOUT_MS`                                                 | Default timeout for `--run`                                                                                         |
| `HYPOTHESIS_COUNCIL_EXECUTOR_<NAME>_COMMAND`, `_ARGS`, `_PROMPT_DELIVERY`, `_MODEL_FLAG` | A custom executor (`--to NAME`), or an override of the built-in with the same name                                  |

## Sources

`hc run --sources FILE` (or `sources.file` in the settings) adds a sources stage before
generation. The file is JSON (an array, or an object with a `sources` array, of records with
`title`, `url`, `doi`, `year`, `venue`, `summary`, and `kind`) or Markdown/plain text with one
source per line:

```markdown
- [Attention is all you need](https://arxiv.org/abs/1706.03762) 2017
- Deep residual learning — https://arxiv.org/abs/1512.03385
- doi:10.1000/example 2021
- A book without a link (kept as a title-only record, never fetched)
```

Each record gets a stable id (`S-001`, `S-002`, ...). The harness fetches every URL or DOI
itself, follows redirects, refuses private-network hosts, caps what it reads, and records one
status: `reachable`, `unreachable`, `blocked`, `skipped`, or `retracted` (a Crossref lookup for
DOIs at skepticism 8 and above). At skepticism 5 and above one council provider grades the
records blind for reliability (1–10), replication (`replicated`, `unreplicated`, `contested`,
`unknown`), and concerns. The records are appended to the sealed packet (at most a quarter of the
budget), hypotheses cite them with the evidence basis `source` and the record id, the evidence
check verifies those citations, and the report ends with a "Sources" section. Kinds are `paper`,
`preprint`, `dataset`, `code`, `documentation`, `article`, and `other`. `--web off` keeps the run
offline: no scouting and no fetches.

## Web scouting

A web scout is a Rubber Duck provider whose name ends in `_scout` (or `-scout`). It has web
search switched on, it runs only in the sources stage, and it is never seated on the council,
whatever `--web` says. The `frontier` preset configures Claude, Codex, and Grok scouts
(`cli-claude_scout`, `cli-codex_scout`, `cli-grok_scout`); `hc doctor` shows a `WEB` column,
marks scouts, and fails when a council member has web access or a scout has web search off.

With `--web auto` (the default) the configured scouts search on every run; `--scouts a,b` names
the scouts to use; `--web off` disables scouting and every fetch. Each scout receives the goal,
the dial policy, the ids already collected, and the file paths from the context manifest, never
the packet, and is asked for a fixed number of primary sources per round: five at the default
novelty, more above it, and a second round at novelty 8 and above. Scouted records that turn out
unreachable or retracted are dropped, and which scout proposed a record is kept private. Configure
a scout by hand with Rubber Duck's custom CLI variables (`CLI_CUSTOM_CLAUDE_SCOUT_COMMAND` and
friends); Codex scouts use `web_search="live"`, overridable through
`HYPOTHESIS_COUNCIL_CODEX_WEB_SEARCH_CONFIG`.

## MCP server

The `hypothesis-council-mcp` binary exposes the project tools over stdio:

- `duck_hypothesis_council` (accepts `sources_file`, `scouts`, and `web` alongside the goal,
  context, and dials)
- `duck_hypothesis_status`
- `duck_hypothesis_report`
- `duck_hypothesis_ask`
- `duck_research_proposal`, `duck_research_proposal_answer`, `duck_research_proposal_report`
  (the interview, drafting, and merged proposal; running an executor is CLI-only)

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
- Source verification confirms only that a URL or DOI resolves and what bytes came back;
  `reachable` does not mean correct, and source summaries and critique grades are model-written.
- Web scouts search the open web with the research goal and your context file paths; use
  `--web off` when the goal itself is confidential.
- A handoff executor in full-auto mode edits your repository without asking; run it on a clean
  branch and read its log.
- Review aggregates are prioritization signals, not probabilities of truth.
- Runs are foreground-owned; exiting interrupts work instead of pretending a daemon exists.
- Explicit Rubber Duck CLI argument overrides are preserved and may therefore receive a smaller
  transport-safe budget than the presets.
- Cancelling closes the session-scoped Rubber Duck MCP subprocess. Rubber Duck 1.20.5 does not
  guarantee termination of an already-spawned vendor CLI grandchild; it may continue until its
  configured provider timeout.
