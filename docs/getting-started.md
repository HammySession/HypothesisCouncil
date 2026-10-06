# Getting started

This walks through the first council run on a repository of your own. It takes about fifteen
minutes, most of which is the run itself.

## 1. Install one or two AI CLIs

The council seats AI coding CLIs that are already installed and signed in on your machine. Start
with one or both of these:

| CLI         | Install                                     | Sign in                        |
| ----------- | ------------------------------------------- | ------------------------------ |
| Claude Code | `npm install -g @anthropic-ai/claude-code`  | run `claude` once and log in   |
| Codex       | `npm install -g @openai/codex`              | run `codex` once and log in    |

Two providers are better than one: with two, every hypothesis is reviewed by the provider that
did not write it. With one, the council still runs, but the review is a self-review and the
report says so.

Grok (`grok`) and Gemini through the Antigravity CLI (`agy`) join in the `frontier` preset later.

## 2. Install hc

```bash
git clone https://github.com/HammySession/HypothesisCouncil.git
cd HypothesisCouncil
npm install
npm link
hc --version
```

`npm install` builds the project. `npm link` makes `hc` available everywhere. If you would rather
not link, `node dist/cli/hypothesis-council.js` is the same command.

## 3. Check what the council can see

```bash
hc doctor
```

Expected output, with Claude Code and Codex installed:

```text
Preset: auto
Platform: linux · Node v24.0.0 · mcp-rubber-duck 1.20.5
Session home: /home/you/.mcp-rubber-duck/hypothesis-council
PROVIDER          MODEL   WINDOW   TRANSPORT  WEB  COMMAND   PROBE
cli-claude        ...     ...      stdin      off  claude ✓  -
cli-codex         ...     ...      stdin      off  codex ✓   -
cli-claude_scout  ...     ...      stdin      on   claude ✓  -
cli-codex_scout   ...     ...      stdin      on   codex ✓   -
```

The `_scout` rows are web scouts. They look for sources before generation and never sit on the
council. If doctor reports a problem, it exits non-zero and prints a hint under it. The usual
causes are a CLI that is installed but not signed in, or none found on PATH.

`hc doctor --probe` also sends a one-line prompt to every provider and times the reply. Do this
once after installing; it costs a few seconds per provider.

## 4. Preview a run

Go to a repository you know well and ask a question you actually have:

```bash
cd /path/to/your-project
hc run "Why does the test suite take twice as long on CI as locally?" --dry-run
```

The preview lists the files that would be sent, the files that were denied (credentials, local
settings, generated directories), the byte budget, and the planned number of provider calls.
Nothing is sent. If the selection is too wide, narrow it:

```bash
hc run "..." --dry-run --context src --context "docs/**/*.md"
hc run "..." --dry-run --markdown-only
```

Read the preview as the final privacy check. The council denies common secret paths, but it
cannot know what is inside an ordinary file.

## 5. Run the council

```bash
hc run "Why does the test suite take twice as long on CI as locally?" --yes
```

The terminal shows one live line per stage: generation (which providers are still thinking),
evidence check, review (which hypotheses are still under review), falsification. A two-provider
run usually takes three to six minutes. Ctrl-C stops the run; completed stages stay on disk and
`hc resume` continues from the last one.

When it finishes you get the top candidates with their verdicts and the report path.

## 6. Read the report

```bash
hc report --html --open
```

Each ranked hypothesis has:

- the claim, mechanism, predictions, and assumptions;
- what it predicts that the consensus explanation does not;
- its evidence, tagged `context` (a quote the harness verified against the packet),
  `general-knowledge` (remembered literature, unverified), or `speculation`;
- the blind review: six scores, the strongest objection, hidden assumptions, and the grade of
  the declared falsifier;
- the adversarial attack: the competing explanation and the discriminating test;
- the minimal experiment that would settle it.

Verdicts are `strong_accept`, `accept`, `uncertain`, `reject`, or `fatal`. The review aggregate
is a priority, not a probability. Look first at hypotheses with a `concrete` falsifier and a
cheap minimal experiment, then run that experiment.

Also useful:

```bash
hc candidates                    # the ranked list
hc show 1                        # one hypothesis in full
hc ask "Which single measurement would separate H-001 from H-002?"
```

`hc ask` answers from the persisted session only and never changes the ranking.

## 7. Next steps

- **The shell.** `hc` with no arguments opens an interactive shell with the same commands as
  `/run`, `/candidates`, `/show`, and plain-text chat with a provider. `/help` lists them.
- **Dials.** `--novelty high` pushes the council away from the obvious explanation; `--skepticism
  high` adds a second adversarial round and ranks unverified claims below verified ones.
- **Presets.** `hc presets` lists `auto`, `quick`, and `frontier`. `hc settings set defaultPreset
  frontier` makes the four-vendor council the default once `grok` and `agy` are installed.
- **Sources.** `hc run --sources sources.md` adds papers and pages the council may cite; the
  harness fetches and grades them first.
- **Proposals.** `hc propose "<topic>"` has the council interview you, draft independently, and
  merge one research proposal that an executor CLI can carry out.

## Troubleshooting

| Symptom                                               | What to do                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `No supported AI CLI was found on PATH`               | Install Claude Code or Codex (step 1) and open a new terminal.                    |
| `hc doctor` lists a provider but `--probe` fails      | Run the CLI by hand once; it is probably not signed in.                           |
| The run stops with a provider timeout                 | Raise `HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS` (milliseconds) or use fewer files. |
| Too few files in the preview                          | Check `--context` patterns; a pattern that matches nothing is warned about.       |
| Too much in the preview                               | Use `--context` or `--markdown-only`, or lower `--max-context-bytes`.             |
| Windows: the packet is capped at 24 KiB               | Use a preset; they deliver prompts through stdin instead of the command line.     |
