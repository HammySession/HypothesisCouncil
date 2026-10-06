# Hypothesis Council

A council of AI coding agents that generate, review, and attack hypotheses about your code.

You give it a repository and a question. Several AI CLIs (Claude Code, Codex, Grok, Gemini)
each propose hypotheses independently, without seeing one another. The council then reviews every
hypothesis blind, tries to falsify the strongest ones, and writes a ranked report with the
evidence, the objections, and the experiment that would settle each claim. Everything is saved
locally, and nothing is sent anywhere until you have seen exactly what will be sent.

Hypothesis Council runs on top of [MCP Rubber Duck](https://github.com/nesquikm/mcp-rubber-duck),
which it installs as a dependency and talks to over its public MCP tools. It does not fork it.

## Quick start

You need Node.js 20 or newer and at least one of these CLIs installed and signed in:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code): `npm install -g @anthropic-ai/claude-code`, then `claude`
- [Codex](https://github.com/openai/codex): `npm install -g @openai/codex`, then `codex`

Install the council:

```bash
git clone https://github.com/HammySession/HypothesisCouncil.git
cd HypothesisCouncil
npm install        # builds dist/ as part of the install
npm link           # puts the hc command on your PATH
```

Then run it on a repository:

```bash
hc doctor                                     # which CLIs and models the council can use
cd /path/to/your-project
hc run "Why is startup slow?" --dry-run       # preview what would be sent; sends nothing
hc run "Why is startup slow?" --yes           # run the council
hc report --html --open                       # open the report in your browser
```

With no preset and no provider configured, `hc` seats whichever of Claude Code and Codex it finds
on your PATH. That is the `auto` preset. A run with both takes a few minutes; the terminal shows
one live line per stage.

[docs/getting-started.md](docs/getting-started.md) walks through the first run step by step and
explains how to read the report.

## What a run does

```text
goal + context preview (you confirm what leaves the machine)
        |
optional sources stage: your sources file + web scouts, fetched and graded
        |
independent generation: every provider gets the same sealed packet, none sees another
        |
mechanical evidence check: context quotes are verified against the packet, not by a model
        |
deduplication and consensus-crowding measurement
        |
blind review: each hypothesis is reviewed by a provider that did not write it
        |
ranking with gates (fatal flaws and untestable falsifiers sink a candidate)
        |
adversarial falsification of the finalists
        |
Markdown, JSON, and HTML report; follow-up questions grounded in the session
```

Models trained on the same literature tend to restate consensus and to treat agreement as
confirmation. The workflow guards against that structurally:

- Every hypothesis must say what it predicts that the consensus explanation does not.
- Supporting claims are tagged `context`, `general-knowledge`, or `speculation`. Context quotes
  are checked mechanically against the packet, so remembered literature cannot pose as evidence.
- Reviewers grade each declared falsifier `concrete`, `vague`, or `untestable`. An untestable
  one ranks below every testable candidate.
- Agreement between providers is reported as consensus crowding, a caution rather than a
  confidence signal. It never raises a rank.
- Two dials, novelty and skepticism, tune how far the council strays from the obvious
  explanation and how much scrutiny evidence receives. The report records both.

## Everyday commands

```bash
hc run                              # default goal, current directory as the repository
hc run "<goal>" --repo PATH         # another repository
hc run --context src --context "docs/**/*.md" --yes    # narrow the context
hc run --markdown-only --yes --out ./HYPOTHESES.md      # Markdown files only; copy the report
hc run --novelty high --skepticism high --yes          # turn the dials (0-10 or low/medium/high)

hc status                 # where the current session is
hc candidates             # ranked hypotheses with verdicts
hc show H-001             # one hypothesis with its review and attacks
hc ask "Which evidence would most change the ranking?"
hc report                 # Markdown; --json, --out PATH, --html, --open
hc reports --tag skew     # catalog of saved reports; --html --open writes the gallery
hc sessions
hc resume                 # continue an interrupted run from its last completed stage
```

`hc run` previews the included, omitted, and denied paths and the planned number of provider
calls, asks for confirmation in a terminal, and requires `--yes` when stdin is not interactive.
Common credential paths, symlinks, generated directories, and local settings files are never
sent, but the preview is the final privacy check.

The context budget is automatic: every provider receives the same packet, sized for the smallest
model window in the council. `--max-context-bytes` lowers it. Large repositories get a path
manifest plus fair excerpts, with project instructions, documentation, source, and tests filled
in that order.

## The interactive shell

`hc` with no arguments opens a shell. Plain text chats with a provider; council work starts only
through a command.

```text
home · auto> /context add src "docs/**/*.md"
home · auto · ctx:2> @claude what does the training loop do?
home · auto · ctx:2> /run Why does validation improve while deployment degrades?
RC-... · auto> /candidates
RC-... · auto> /show 1
RC-... · auto> Which experiment best separates H-001 from H-003?
RC-... · auto> /report html
RC-... · auto> /tag add skew,serving
```

The prompt shows the selected session, the providers plain text goes to, the preset, the dials
when they are off their defaults, and the size of the context basket. With a session selected,
plain text asks a question grounded in its persisted candidates, reviews, and attacks and never
changes the ranking. `/help` lists every command. Tab completes commands, session ids, provider
names, and paths. History persists in `<session home>/shell-history`.

The context basket (`/context add`, `/context add-text`, `/repo`, `@path` in a message) is shared
by chat and `/run`. Pasted snippets are stored as files under the session home so the same denial
rules and byte budget apply. The first message that carries a packet previews it and asks once.

## Presets

A preset configures providers, models, timeouts, and prompt transport in the current process
before Rubber Duck starts. Nothing is written to your shell profile or to Rubber Duck's config.

| Preset     | Council                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `auto`     | Claude Code and Codex, whichever are installed. The default when nothing else is configured.       |
| `quick`    | Claude Code and Codex, both required. A fast two-provider council.                                 |
| `frontier` | Grok, Gemini (through the Antigravity CLI `agy`), Claude Code, and Codex at high reasoning effort. |

```bash
hc presets                         # the table above, with the pinned models
hc doctor --preset frontier        # check a preset before spending a run on it
hc run --preset frontier --yes
hc settings set defaultPreset frontier
```

The `frontier` preset picks the newest model per vendor automatically by reading each CLI's own
catalog (never its credentials), and `hc models` shows the choice. `--model codex=gpt-6-astra`
pins one slot; `hc settings set modelPolicy pinned` reproduces the preset pins on every run.
Prompts reach every CLI through stdin, so the shared packet is not capped by the operating
system's command-line limit (24 KiB on Windows).

If you prefer to configure Rubber Duck yourself, through `CLI_CLAUDE_ENABLED=true` and friends or
`~/.mcp-rubber-duck/config.json`, the council uses that configuration and selects no preset.

## Settings

Every value resolves as command flag, then environment variable, then settings file, then
default. `hc settings` prints each value with its origin.

```bash
hc settings                         # effective values and where each comes from
hc settings set novelty high        # writes <session home>/settings.json
hc settings set defaultPreset quick
hc settings unset novelty
hc settings path | reset | help
```

| Key              | Flag              | Environment variable              | Meaning                                  |
| ---------------- | ----------------- | --------------------------------- | ---------------------------------------- |
| `novelty`        | `--novelty`       | `HYPOTHESIS_COUNCIL_NOVELTY`      | 0-10 or `low`/`medium`/`high`; default 5 |
| `skepticism`     | `--skepticism`    | `HYPOTHESIS_COUNCIL_SKEPTICISM`   | 0-10 or `low`/`medium`/`high`; default 5 |
| `defaultPreset`  | `--preset`        | `HYPOTHESIS_COUNCIL_PRESET`       | preset used when a run names none        |
| `defaultContext` | `--context`       |                                   | context paths used when a run names none |
| `markdownOnly`   | `--markdown-only` |                                   | send only Markdown and MDX files         |
| `modelPolicy`    |                   | `HYPOTHESIS_COUNCIL_MODEL_POLICY` | `latest` (newest per vendor) or `pinned` |
| `sources.file`   | `--sources`       | `HYPOTHESIS_COUNCIL_SOURCES`      | default sources file                     |
| `sources.scouts` | `--scouts`        | `HYPOTHESIS_COUNCIL_SCOUTS`       | web scouts for the sources stage         |
| `sources.web`    | `--web`           | `HYPOTHESIS_COUNCIL_WEB`          | `auto`, `on`, or `off`                   |

Sessions live in `~/.mcp-rubber-duck/hypothesis-council`; `HYPOTHESIS_COUNCIL_HOME` moves them.
`HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS` sets the per-call provider timeout (five minutes by
default, fifteen for `frontier`). `HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_<PROVIDER>` overrides the
context window assumed for one provider, for example `..._CLI_CODEX=1050000`.

## Novelty and skepticism

Level 5/5 is the balanced default. The dials change prompts, the extra calls the council makes,
and the ranking rules, never the independence barrier or the blinding.

| Level | Novelty                                                        | Skepticism                                                                                       |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0-2   | Prefer the most plausible mechanisms                           | Well-known results may be cited without proof; no source verification                            |
| 6-7   | Novelty weighs more; consensus-crowded candidates lose points  | Candidates without verified context evidence lose points; the report lists weakly supported ones |
| 8-10  | One extra sealed "out-of-the-box" generation call per provider | A second adversarial round per finalist; unverified candidates rank below verified ones          |

`hc run --dry-run` shows the resulting call budget before anything is sent.

## Sources and web scouting

`hc run --sources FILE` adds a sources stage before generation. The file is JSON (an array of
records with `title`, `url`, `doi`, `year`, `venue`, `summary`, `kind`) or Markdown with one
source per line:

```markdown
- [Attention is all you need](https://arxiv.org/abs/1706.03762) 2017
- Deep residual learning - https://arxiv.org/abs/1512.03385
- doi:10.1000/example 2021
- A book without a link (kept as a title-only record, never fetched)
```

The harness fetches every URL or DOI itself, follows redirects, refuses private-network hosts,
caps what it reads, and records `reachable`, `unreachable`, `blocked`, `skipped`, or `retracted`.
At skepticism 5 and above one provider grades the records blind for reliability and replication.
The records join the sealed packet, hypotheses cite them by id, and the report ends with a
"Sources" section.

A web scout is a provider whose name ends in `_scout`. It has web search on, runs only in the
sources stage, and never sits on the council. The presets configure a scout per vendor; `--web
off` disables scouting and every fetch, which is the right setting when the goal itself is
confidential.

## Research proposals

`hc propose` turns a topic into one executable research proposal. The council interviews you
first (every provider proposes questions independently, merged without author labels), then the
providers draft independently, each draft is critiqued blind by a non-author, and the ranked
drafts are merged into one proposal that keeps dissenting designs as alternatives.

```bash
hc propose "Does serving skew explain the validation gap?" --context src --from RC-...
hc propose questions
hc propose answer Q-001 "Daily batch inference over ~2M rows" --skip Q-002
hc propose done                          # finish the interview, then draft, critique, merge
hc propose report
hc propose handoff --to codex --repo /path/to/project --run --yes
```

A handoff writes a bundle (proposal, transcript, context manifest, executor prompt) under the
session, and `--run` launches one executor CLI in your repository to carry the steps out. The
executor runs in full-auto mode and may change files, so the CLI refuses a dirty git tree unless
`--allow-dirty`, prints the exact command, and asks for confirmation. `hc propose help` lists
every subcommand; [docs/design.md](docs/design.md) describes the executor safety rules.

## MCP server

`hypothesis-council-mcp` exposes the council and proposal workflows as MCP tools over stdio for
use from another agent. Presets are a CLI feature, so configure providers for the server through
Rubber Duck's environment variables or config file. [docs/tools.md](docs/tools.md) lists the
tools.

## Development

```bash
npm run check   # typecheck, lint, tests, build: the merge gate
```

Tests use fake providers and in-memory MCP transports and never call a live model. Two
package-contract tests that shadow the real `codex` and `claude` executables are skipped on
Windows by design.

- [docs/getting-started.md](docs/getting-started.md): first run, step by step
- [docs/design.md](docs/design.md): architecture, guardrails, and persistence
- [docs/tools.md](docs/tools.md): the MCP tool surface
- [docs/history/original-spec.md](docs/history/original-spec.md): the original design brief
- [CHANGELOG.md](CHANGELOG.md)

## Limits

- "Blind" means provider labels are removed; writing style is not normalized.
- Secret-path filtering cannot detect every secret inside an ordinary file. Read the preview.
- Model review is structured debate, not experimental validation. Review scores are priorities,
  not probabilities.
- Evidence verification confirms that a quote appears in the packet and that a source resolves.
  It does not confirm that either is right.
- Web scouts send the research goal and your context file paths to the open web.
- A handoff executor edits your repository without asking. Run it on a clean branch.
- Cancelling closes the Rubber Duck subprocess, but an already-spawned vendor CLI may keep
  running until its timeout.

## License

MIT.
