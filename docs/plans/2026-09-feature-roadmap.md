# Hypothesis Council feature roadmap (2026-09-04)

Step-by-step change list for four features: the interactive CLI upgrade, automatic latest-model
selection, the research-proposal interview mode, and the novelty/skepticism dials. Steps are
ordered so that every step leaves `npm run check` green and later steps build on earlier ones.
Each step names the files it adds or modifies, the tests it requires, and the docs it touches.

Conventions that apply to every step: TypeScript ESM with `.js` relative imports; unit tests under
the matching `tests/` path with fake providers or in-memory MCP peers; no live models in tests;
`src/research/` stays free of MCP SDK, readline, and subprocess code; `src/rubber-duck/` is the
only Rubber Duck boundary; public status, report, and CLI JSON never expose author, reviewer,
synthesizer, or critic provider identities.

## 0. Status (2026-09-04)

Phases 0–6 are implemented on the working tree (not yet committed) with `npm run check` green.
Deviations from the plan below, recorded so the plan stays an honest history:

- `--web auto|on|off`, `--sources`, and `--scouts` resolve through the settings layer
  (`sources.web`, `sources.file`, `sources.scouts` with `HYPOTHESIS_COUNCIL_WEB`,
  `HYPOTHESIS_COUNCIL_SOURCES`, `HYPOTHESIS_COUNCIL_SCOUTS`) rather than as run-only flags, so
  the shell, `hc run`, and the settings file share one validation path.
- A provider named `*_scout` is excluded from the council by name, whichever way `--web` is set;
  the sources stage is the only place it runs.
- Source verification is injected into the research service through `createCouncilRuntime`
  options (`createFetchSourceVerifier` in production, a skipped verifier in tests), keeping
  `src/research/` free of network defaults.
- The sources appendix ends with a newline so the sealed packet on disk is byte-for-byte what
  the manifest hashes.
- Gemini scouts and executors run through the `agy-stream-json` shim; Grok scouts through the
  prompt-file shim with web search left on.

## 1. Findings that shape the plan

These were verified against the code, the installed `mcp-rubber-duck@1.20.5` package, and the
vendor CLIs on this machine.

1. **Grok can already search the web during council runs.** `grok` 1.0.5 enables web search by
   default and the `frontier` preset (`src/cli/presets.ts:54-60`) never passes
   `--disable-web-search`. This contradicts `NON_INTERACTIVE_NOTICE` and the independence
   barrier. Fix in Phase 0.
2. **Rubber Duck cannot discover vendor-CLI models.** `list_models`
   (`node_modules/mcp-rubber-duck/src/providers/cli/cli-provider.ts:71-87`) returns only the
   configured `DEFAULT_MODEL` for CLI providers; `fetch_latest` only changes a footer line. The
   `ask_duck` `model` parameter is ignored for `cli_type: 'custom'` providers
   (`cli-provider.ts:165-177`), which is what every Hypothesis Council provider is after
   `moveDefaultPresetToStdin`. Model resolution must therefore happen before launch, through
   the public `*_DEFAULT_MODEL` and `*_CLI_ARGS` environment variables, and discovery must come
   from the vendor CLIs themselves.
3. **Vendor CLIs do expose model lists.** `codex debug models` prints the catalog JSON that is
   also cached at `~/.codex/models_cache.json` (fields `slug`, `visibility`, `priority`,
   `upgrade`, `context_window`, `supported_reasoning_levels`). `grok models` prints the list and
   `~/.grok/models_cache.json` caches it, but that file also holds `api_key` objects and must be
   read field-by-field. `agy models` prints a tab-separated `id<TAB>name` list including
   non-Gemini ids. `claude` has no list command, but `~/.claude.json` carries
   `additionalModelOptionsCache` with the concrete id `claude-fable-5-1[1m]`. The `frontier`
   preset still pins `claude-fable-5[1m]`, so it is already behind.
4. **The Codex catalog reports a 272,000-token context window** (872,000 max) for `gpt-5.6-sol`,
   where the preset assumes 1,050,000. Resolved in section 10: the discovered window is trusted.
5. **Web search flags per CLI.** Claude: `--tools WebSearch,WebFetch` plus `--restricted`
   (keeps file tools confined). Codex: `codex exec` rejects `--search`; the override is
   `-c web_search="live"` and cannot be validated offline. Grok: on by default. AGY: no web
   option, so it stays council-only.
6. **The shell is not testable today.** `src/cli/hypothesis-council.ts` executes at module load,
   keeps all state in closures, and `/run` passes its whole remainder as one positional, so no
   flags work inside the shell. Every new shell feature depends on extracting it first.
7. **Orchestrator plumbing is private.** `invoke`, `invokeWithBlankRetry`, parse-plus-repair,
   `recordParsed`, and `preflight` in `src/research/orchestrator.ts` are typed to
   `ResearchSession`; the proposal service needs them extracted. `store.createId` hard-codes the
   `RC-` prefix and `list()` filters on it.
8. **Parallel `service.ask` calls collide.** The call id is `ask-${Date.now()}`
   (`orchestrator.ts:245`), so multi-provider session chat would drop call records.
9. **Context-window mapping mislabels unknown ids.** `src/research/context-budget.ts:69` reports
   `source: 'model'` for any string that is not literally `cli` or `provider-default`, so a new
   id silently gets a wrong window without the "assumed" warning.

## 2. Cross-cutting decisions

- **Shell architecture.** A command registry (`src/cli/shell/commands/*.ts`) plus an explicit
  `ShellContext`/`ShellState`; tests fake at the `RubberDuckClient` level so the real gateway and
  service are exercised without a TTY.
- **Settings.** Pure zod schema and precedence in `src/research/settings.ts`, file IO in
  `src/research/settings-store.ts`, file at `<HYPOTHESIS_COUNCIL_HOME>/settings.json` (atomic,
  mode 0600, strict keys). Precedence: CLI flag > environment > settings file > default. The CLI
  only renders (`src/cli/settings-view.ts`) and edits (`/set`, `/unset`).
- **Dials.** Integers 0-10 with `low`/`medium`/`high` aliases (2/5/8). Level 5/5 reproduces
  today's behaviour exactly so existing sessions, fixtures, and tests stay valid. One derivation
  point, `src/research/dials.ts`, turns the two dials into a `DialPolicy` that every stage reads.
- **Model policy.** Default `latest`; `pinned` reproduces today's presets and is the one-line
  rollback. Explicit user values always win: `--model KEY=ID`, then `CLI_*_DEFAULT_MODEL` present
  before any preset ran, then discovered latest, then the preset pin, then a curated table.
  Discovery and ranking live in `src/cli/` (provider configuration is a CLI concern) and spawn
  only read-only listing commands.
- **Web retrieval.** A separate `sourcing` stage before generation. Scouts are separate Rubber
  Duck custom providers (`cli-claude_scout`, `cli-codex_scout`, `cli-grok_scout`) excluded from
  the council. Every generator receives the identical `SOURCES` block inside the sealed packet;
  generators never gain tools. Sources are verified mechanically (fetch status, hash, title,
  optional Crossref retraction lookup). A user-supplied sources file is the always-available
  path.
- **Proposal sessions.** Separate `RP-` sessions with their own store and `current-proposal`
  pointer via a generic `SessionStoreBase<T>`. Interview is sealed by default (each provider sees
  only its own questions and the user's answers), drafts are independent, critique is blinded and
  non-author, one seed-rotated synthesizer must preserve dissent as alternatives. Handoff writes a
  bundle; live execution spawns the vendor CLI directly from a new `src/executor/` module with
  the target repository as cwd, because Rubber Duck pins tools off, buffers output, and cannot
  kill the vendor grandchild. Executors run in full-auto mode by default (no approval prompts)
  behind an explicit confirmation that shows the exact command line.
- **Identity hygiene.** New private fields (`sources[].provider`, `authorProvider`,
  `reviewerProvider`, `synthesizerProvider`, `criticProvider`) are stripped in every public
  projection; each step's tests assert `JSON.stringify(public)` contains none of them.

## 3. Phase 0: foundations (no behaviour change)

### 0.1 Extract the CLI entry point into testable modules and a shell registry

Files to add:

- `src/cli/arguments.ts`: move `ParsedArguments`, `parseArguments`, `flag`, `flagValues`,
  `numberFlag`, `pathFlag`, `BOOLEAN_FLAGS`.
- `src/cli/report-files.ts`: move `resolveOutputPath`, `copyReport`, `reportText`; add
  `ensureHtmlReport(store, session)` that renders `report.html` when missing or older than
  `report.md`.
- `src/cli/run-command.ts`: move `runCommand`, `confirmRun`, `printRunPreview`, `selectPreset`,
  `progressRenderer`; accept `io`, `env`, and `runtimeFactory` instead of touching `process.*`.
- `src/cli/shell/io.ts`: `ShellIO { out, err, confirm(question), readBlock(prompt, terminator),
isInteractive }`, `createTerminalIO(rl, stdout, stderr)` with a `feedLine` hook, and
  `createMemoryIO({ confirm?, blocks? })` for tests.
- `src/cli/shell/tokenize.ts`: `splitShellArguments(line)` with quotes and escapes.
- `src/cli/shell/context.ts`: `ShellState` (selectedSession, selection, preset, repoRoot, basket,
  chats, approvedContextHashes, lastReportListing, providerCache, dials, closing) and
  `ShellContext` (store, runtimeFactory, env, platform, cwd, io, openInBrowser, now,
  locateCommand, state, signal).
- `src/cli/shell/registry.ts`: `ShellCommand { name, aliases?, usage, summary, run(ctx, args) }`,
  `parseShellLine`, `dispatchShellLine(ctx, line, commands)`.
- `src/cli/shell/help.ts`: `shellHelpText(commands)` generated from usage and summary.
- `src/cli/shell/commands/{help,exit,status,candidates,show,sessions,presets,preset,doctor,use,duck,report,resume,run}.ts`
  plus `index.ts` exporting `SHELL_COMMANDS`. Behaviour identical to today except `/run` now
  tokenizes its arguments and accepts every `hc run` flag.
- `src/cli/shell/chat.ts`: `chatFallback(ctx, text)` with today's single-duck behaviour, history
  kept in `state.chats`.
- `src/cli/main.ts`: `executeCommand(args, store, deps)` and `runInteractive(store, deps)`
  (readline, one `AbortController` per line, SIGINT handling, history, `dispatchShellLine`).

Files to modify:

- `src/cli/hypothesis-council.ts`: shrink to the shebang, store construction, `executeCommand`,
  and error reporting.
- `src/cli/doctor.ts`: export `providerKey`; move `table` to `src/cli/format.ts` and export it.

Tests: `tests/cli/arguments.test.ts`, `tests/cli/shell/tokenize.test.ts`,
`tests/cli/shell/registry.test.ts` (routing, aliases, unknown command, plain text to chat),
`tests/cli/shell/commands.test.ts` (seeded tmp store; `/status`, `/candidates`, `/show 1`,
`/use`, `/sessions`, `/duck`, `/preset quick` with a fake `locateCommand`, `/exit`, `/report html`
calls the injected opener), `tests/cli/shell/fakes.ts` (`FakeRubberDuckClient` scripted by
provider and prompt prefix, `createTestContext()`), `tests/cli/main.test.ts` (`hc sessions`,
`hc report --html` through `executeCommand`).

Docs: none.

### 0.2 Extract orchestrator plumbing and generalise the store

Files to add:

- `src/research/calls.ts`: `CallHost { id, calls, warnings }`, `CallSpec` (moved), class
  `CouncilCalls(gateway, store)` with `invoke`, `invokeWithBlankRetry`,
  `parseWithRepair<T>(host, spec, schema, repair)`, `recordParsed`, `throwIfAborted`; and
  `preflightProviders(gateway, store, host, progress, signal)`. Bodies move verbatim from
  `orchestrator.ts:316-366` and `686-774`.

Files to modify:

- `src/research/store.ts`: `abstract class SessionStoreBase<T extends { id; updatedAt }>`
  parameterised by id prefix and current-pointer file name, holding `sessionDirectory`,
  `save`, `load`, `currentId`, `use`, `list`, `writeCallArtifact`, `writeReport`,
  `writeContextPacket`, `readContextPacket`, `atomicWrite`. `ResearchSessionStore extends
SessionStoreBase<ResearchSession>` with `RC-` and `current`; public API unchanged. Add
  `updateMeta(sessionId, patch)` (merge without bumping `updatedAt` or moving `current`),
  `artifactPath(sessionId, filename)`, `artifactExists`.
- `src/research/orchestrator.ts`: delegate to `CouncilCalls` and `preflightProviders`; change
  the ask call id to `ask-${provider}-${Date.now()}`.
- `src/research/dedup.ts`: export `textSimilarity(left, right)` and
  `clusterBySimilarity<T>(items, text, threshold)`; `candidateSimilarity` becomes a wrapper.
- `src/research/assignment.ts`: export `stableHash`; widen `assignReviewers` to
  `T extends { id; authorProvider }`.
- `src/research/types.ts`: `SessionMeta { title?, tags?, summary?, preset? }`,
  `ResearchSession.meta?`, `RunResearchInput.meta?` (copied by `run`), `ProviderCallRecord.stage`
  widened for later stages.
- `src/research/report.ts`: `publicSessionSnapshot` includes `meta`.

Tests: existing suites unchanged; add `tests/research/store.test.ts` (`updateMeta` keeps
`updatedAt` and `current`, merges tags), `tests/research/core.test.ts` cases for
`textSimilarity` and order-independent `clusterBySimilarity`, orchestrator test that two parallel
asks keep two call records and that `meta` passes through `run`.

Docs: none.

### 0.3 Close the Grok web-search leak

Files: `src/cli/presets.ts` (add `--disable-web-search` to the council Grok args),
`tests/cli/presets.test.ts` (expectation update), README prompt-transport paragraph (one
sentence). This ships independently of the dials.

## 4. Phase 1: settings and dials core

### 1.1 Settings schema, file, and commands

Files to add:

- `src/research/settings.ts`: `DIAL_ALIASES`, `DialSchema` (0-10 or alias), strict
  `CouncilSettingsSchema { version, novelty=5, skepticism=5, defaultPreset?, defaultContext?,
markdownOnly?, modelPolicy='latest', sources { file?, scouts?, web='auto' } }`,
  `resolveSettings({ flags, env, file }) -> { values, origins, filePath }`.
- `src/research/settings-store.ts`: `settingsPath(root)`, `loadSettingsFile`,
  `saveSettingsFile(path, patch)`, `unsetSetting`; atomic write, mode 0600; missing file is `{}`;
  invalid file is an error naming the path with an `hc settings reset` hint.
- `src/cli/settings-view.ts`: `settingsText(resolved, extras)` and `parseSettingsArgs`.
- `src/cli/shell/commands/{settings,set,unset}.ts`.

Files to modify: `src/cli/main.ts` (`hc settings [--json] | set KEY VALUE | unset KEY | path |
reset`; resolve settings once per command), `src/cli/arguments.ts` (`--novelty`, `--skepticism`,
`--sources`, `--scouts`, `--web`), `src/cli/shell/context.ts` (`state.dials` from resolved
settings; prompt suffix `N8/S5` when non-default), `src/server.ts` (resolve env plus file for
defaults).

Environment variables: `HYPOTHESIS_COUNCIL_NOVELTY`, `HYPOTHESIS_COUNCIL_SKEPTICISM`,
`HYPOTHESIS_COUNCIL_PRESET`, `HYPOTHESIS_COUNCIL_SOURCES`, `HYPOTHESIS_COUNCIL_SCOUTS`,
`HYPOTHESIS_COUNCIL_WEB`, `HYPOTHESIS_COUNCIL_MODEL_POLICY`.

Tests: `tests/research/settings.test.ts` (aliases, range errors, strict unknown keys,
precedence with origins), `tests/research/settings-store.test.ts` (missing, invalid, mode,
patch and unset round-trip), `tests/cli/settings-view.test.ts`, shell command tests for `/set`
warning when an env var shadows the key.

Docs: README "Settings" section (path, precedence, commands).

### 1.2 Dial policy applied to prompts, ranking, crowding, generation, falsification, report

Files to add:

- `src/research/dials.ts`: `resolveDialPolicy({ novelty, skepticism }, hypothesesPerProvider)
-> DialPolicy` with novelty weight `1 + 0.15*(n-5)`, robustness weight likewise, crowding
  threshold `0.45 - 0.02*(n-5)`, crowding penalty `max(0,(n-5)/5)*1.5`, out-of-box call count,
  unsupported-evidence penalty, unverified-finalist gate, falsification rounds (2 at high
  skepticism), source counts and rounds, source verification mode, source-critique flag,
  weak-claims flag. Level 5/5 yields today's constants.

Files to modify:

- `src/research/types.ts`: `RunResearchInput.dials?`, `ResearchConfig.dials?` (values plus
  origins) and `policy?`, `ResearchRunPreview.dials/policy`, `PlannedProviderCalls.outOfBox` and
  `falsificationRounds`, `HypothesisFalsification.round?`, call stage `generation-outofbox`.
- `src/research/prompts.ts`: bump generation, review, falsification and their repairs to v4;
  add `generationOutOfBox: 'hypothesis-generation-outofbox:v1'`; `buildGenerationPrompt(goal,
packet, count, policy, variant)`; a `DIALS` line in every council prompt; novelty block
  (plausibility-first at low, "at least one hypothesis must contradict the dominant explanation"
  at high); skepticism block in review ("assume any cited work may be wrong, retracted, or
  non-replicating; require effect sizes, sample sizes, and independent replication") and in
  falsification ("attack the evidence"). Write the v4 text to already cover the `source` evidence
  basis and reliability grades so Phase 5 needs no further bump.
- `src/research/ranking.ts`: `rankCandidates(candidates, reviews, options?)` with weighted mean,
  crowding penalty, unsupported-evidence penalty, and an extra gate level; export
  `explainRanking(policy)`.
- `src/research/orchestrator.ts`: resolve policy in `prepare`; `planProviderCalls(providers,
hpp, topK, policy)`; pass the crowding threshold; run the out-of-box batch inside the same
  sealed `Promise.all`; second falsification round with `seed + 2` and the first attacker
  excluded; persist `config.dials` and `config.policy`.
- `src/research/report.ts`: `## Session configuration` (dials with origins, ranking numbers,
  rounds, prompt versions); `## Weakly supported claims` when flagged; method notes say crowding
  may lower rank at high novelty.
- `src/cli/run-options.ts`, `src/cli/format.ts` (preview shows dials and planned extra calls),
  `src/server.ts` (`novelty`, `skepticism` inputs).

Tests: `tests/research/dials.test.ts` (5/5 equals baseline, monotonic, endpoints),
`tests/research/core.test.ts` (5/5 ranking unchanged; novelty 10 penalises a crowded candidate;
skepticism 10 penalises all-general-knowledge evidence and gates unverified below verified),
`tests/research/prompts.test.ts` (v4 prefixes, `DIALS` line, blocks appear only at the right
levels), `tests/research/orchestrator.test.ts` (update `ScriptedGateway` prefixes; novelty 10
creates `generation-outofbox-*` calls with identical prompts per variant; skepticism 10 creates
two falsification records per finalist with different reviewers; config persisted; report has the
new section), `tests/cli/format.test.ts`, `tests/server.test.ts`.

Docs: README "Novelty and skepticism dials" with the mapping table; `docs/hypothesis-council.md`
"Dials" under epistemic guardrails and the ranking paragraph; `docs/tools.md` inputs.

## 5. Phase 2: automatic latest-model selection

### 2.1 Pure model ranking and curated fallback

File to add: `src/cli/model-selection.ts` with `ModelVendor`, `ModelPolicy`, `ModelSource`,
`DiscoveredModel { id, displayName?, contextWindowTokens?, hidden?, supersededBy?, priority?,
reasoningLevels?, source }`, `parseModelId(id) -> { family, version[], tier?, effort?,
contextSuffix?, excludedVariant?, snapshotDate? }`, `pickLatestModel(vendor, models)`,
`CURATED_LATEST`, `resolveModelChoice({ vendor, pinned, pinnedContextTokens?, explicit?,
discovered, policy }) -> ResolvedModel { id, origin: explicit|latest|pinned|fallback,
contextWindowTokens?, discoveredCount, source?, pinned }`.

Ranking order: drop hidden, superseded, foreign-vendor ids (AGY lists Claude and GPT-OSS), and
excluded variants (`mini`, `nano`, `lite`, `spark`, `preview`, `exp`, dated snapshots) unless
nothing remains; then a per-vendor order. Claude, Codex, and Grok rank family first (claude:
fable > opus > sonnet > haiku; codex: gpt > o-series then vendor priority; grok: `grok-N` >
`grok-code-*`) and numeric version second. Gemini ranks numeric version first and tier second
(pro > flash > flash-lite within the same version), so `gemini-3.8-flash-high` beats
`gemini-3.1-pro-high`; `HYPOTHESIS_COUNCIL_MODEL_FAMILY_GEMINI=pro` restores pro-first. Then
`[1m]` preferred; effort high > medium > low; vendor priority then lexical.

Curated table (only ids seen on this machine or already in the repo): claude
`claude-fable-5-1[1m]`, `claude-fable-5[1m]`; codex `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-5.6-luna`, `gpt-5.5`; gemini `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`,
`gemini-3.1-pro-high`; grok `grok-4.6`, `grok-4.5`.

Tests: `tests/cli/model-selection.test.ts` (parse fixtures; per-vendor picks from the real
lists, with gemini choosing `gemini-3.8-flash-high` and the pro-first knob choosing
`gemini-3.1-pro-high`; exclusions fall back; shuffled input is stable; precedence matrix).

### 2.2 Context-window table fix

File: `src/research/context-budget.ts`. `modelLimit` returns `matched`; unmatched ids report
`source: 'provider-default'`; rules for `[1m]` (1,000,000 on any vendor), bare aliases
`fable|opus|sonnet|haiku` (200k), and `gpt-5.x-(sol|terra|luna)`.
Tests in `tests/research/context-budget.test.ts` (`fable[1m]` and `claude-fable-5-1[1m]` are
1M; `gpt-5.6-terra` equals sol; unknown id is `provider-default` and doctor prints "assumed").

### 2.3 Discovery and cache

File to add: `src/cli/model-discovery.ts` with injectable `CommandRunner`, `DiscoveryOptions
{ environment, platform, homeDirectory, cachePath, ttlMs, refresh, timeoutMs, run,
locateCommand, now }`, `discoverModels(vendors, options) -> Record<ModelVendor,
VendorDiscovery { vendor, models, source, fetchedAt, fresh, error? }>`, and
`resolveCouncilModels(preset, { policy, explicit, snapshot, cachePath, refresh })`.

Sources in order: codex `~/.codex/models_cache.json` (honour `CODEX_HOME`) if fresh else
`codex debug models`; grok `~/.grok/models_cache.json` reading only `info.{id,name,
context_window,hidden,reasoning_efforts[].id}` else `grok models`; agy `agy models` filtered to
`gemini-*`; claude `~/.claude.json` `additionalModelOptionsCache[].value` plus
`~/.claude/settings.json` `model` (honour `CLAUDE_CONFIG_DIR`), no spawn. Any failure falls to
the HC cache even if stale, then to `CURATED_LATEST`. Vendors run in parallel with a 15 s
timeout (`HYPOTHESIS_COUNCIL_MODEL_DISCOVERY_TIMEOUT_MS`); `.cmd` shims go through `cmd /c` on
Windows. Cache `<session home>/models-cache.json` `{ version: 1, vendors }`, atomic, mode 0600,
24 h TTL (`HYPOTHESIS_COUNCIL_MODEL_CACHE_TTL_MS`); only normalised fields are ever written.

Tests: `tests/cli/model-discovery.test.ts` with fixture strings from the real outputs, a fake
runner, temp dirs, and an injected clock: fresh cache spawns nothing; stale spawns; refresh
spawns; runner failure falls back; the written cache never contains a fake `api_key`; AGY filter
drops non-Gemini ids; timeouts yield `error` plus fallback, never a rejection.

### 2.4 Preset model slots

File: `src/cli/presets.ts`. `CouncilPreset.modelSlots?: { key, vendor, providerName, pinned,
pinnedContextTokens? }[]`; `PresetContext.models: Record<string, ResolvedModel>`; `frontier`
reads slot ids into `-m`, `--model`, `CLI_CLAUDE_DEFAULT_MODEL`, `CLI_CODEX_DEFAULT_MODEL`, and
`HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_*` from the discovered window, falling back to the pin
only when discovery reports none. The discovered window is trusted as-is: for Codex that is the
catalog's 272,000 tokens, not the preset's 1,050,000, and a user-set
`HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX` still overrides it. The AGY slot's pinned
fallback becomes `gemini-3.8-flash-high`. Policy-aware summary text. `applyPreset(preset, env, { execPath, shimPath, models? })` defaults to
`pinnedModels(preset)` so current callers and tests are unchanged. Helpers
`explicitModelsFromEnvironment(snapshot, preset)` and `explicitContextTokens(snapshot, name)`
preserve user values the way the timeout is preserved today.
Tests in `tests/cli/presets.test.ts`: resolved models flow into every env var; explicit
`CLI_CODEX_DEFAULT_MODEL` wins over discovery; `--model` wins over both; `pinned` never calls
discovery.

### 2.5 CLI wiring

Files: `src/cli/main.ts` (snapshot `process.env` at startup before any preset runs; async
`selectPreset` returns `{ preset, models }`; print the resolved models per slot with origin),
`src/cli/arguments.ts` (`--model KEY=ID` repeatable, `--model-policy latest|pinned`,
`--refresh`), new `hc models [--preset NAME] [--refresh] [--json]` and `/models [refresh]`
(`src/cli/shell/commands/models.ts`), `src/cli/format.ts` (`runPreviewLines` show resolved
models and origins; `errorHints` suggest `hc models --refresh`), `src/cli/settings-view.ts`
(model policy origin), `scripts/run-stock-embeddings-markdown.mjs` header comment.
Tests: `tests/cli/model-flags.test.ts` (`parseModelFlags` keyed map, rejects entries without
`=`), `modelsText` snapshot in the discovery test, preview lines in `tests/cli/format.test.ts`.

### 2.6 Doctor integration

File: `src/cli/doctor.ts`. `DoctorOptions.models?`, `DoctorProviderReport.modelSelection?
{ origin, discoveredCount, source?, pinned }`; MODEL column renders `gpt-5.6-sol (auto: latest
of 7)`, `(pinned)`, `(explicit)`, `(fallback: discovery failed)`; hint when a pin is behind a
discovered id; hint when an auto-selected model has an assumed window.
Tests in `tests/cli/doctor.test.ts`; docs in README "Model selection" (precedence, env vars,
`hc models`, cache location, which listing commands are spawned) and `docs/hypothesis-council.md`
package-boundary paragraph.

## 6. Phase 3: interactive CLI

### 3.1 Settings view with providers, models in use, and available models

Files: `src/cli/settings-view.ts` gains `collectSettings({ gateway, workingDirectory,
sessionHome, env, platform, shell, discovery, rubberDuckVersion, signal }) -> SettingsReport
{ sessionHome, rubberDuckVersion, preset, modelPolicy, repoRoot, selectedSession,
selectedProviders, context { markdownOnly, basketPaths, snippetCount, defaultContextPaths },
dials, providers: SettingsProviderEntry[], problems, hints }` where each provider entry carries
`name, nickname, model, modelSource: explicit|auto-latest|pinned|rubber-duck-default,
availableModels (from the discovery cache for CLI vendors), modelEnvVar, transport,
contextWindowTokens, contextSource`. `/settings` and `hc settings` render it; `/models refresh`
updates the same state without re-running discovery elsewhere.
Tests: `tests/cli/settings-view.test.ts` (env var names for preset, custom, and HTTP providers;
model source labels; dial rows; no `authorProvider` key in JSON).
Docs: README "Setup" mentions `hc settings`.

### 3.2 Report catalog, tags, and session meta

Files to add:

- `src/cli/reports/tags.ts`: `deriveTags(session, max = 6)` from title, goal (weight 2), and
  top-3 candidate titles (weight 1) with stopwords; user tags first.
- `src/cli/reports/catalog.ts`: `ReportEntry { index, id, title, goal, tags, userTags,
createdAt, elapsedMs?, status, stage, stageLabel, providerCount, configuredProviderCount,
distinctCandidates, topCandidate?, preset?, markdownOnly, reportMarkdownPath?, htmlPath?,
summary?, kind }`, `sessionElapsedMs`, `buildReportCatalog`, `filterReportCatalog({ text?,
tag? })`, `resolveReportReference(entries, ref)` (index, exact id, unique prefix or suffix),
  `reportsText(entries)`.

Files to modify: `src/cli/run-command.ts` and `src/cli/run-options.ts` pass
`meta: { preset }`.
Tests: `tests/cli/reports/tags.test.ts`, `tests/cli/reports/catalog.test.ts` (ordering,
elapsed from calls, case-insensitive filters, reference resolution, no author names in text),
`tests/cli/run-options.test.ts`.

### 3.3 `/reports`, `/open`, `/tag`, and the gallery

Files to add: `src/cli/reports/gallery.ts` (`renderReportsGallery(entries, { generatedAt,
home })` self-contained HTML with tag chips, links to `./<id>/report.html`, and a small inline
filter; `writeGallery(store, entries)` to `<home>/index.html`),
`src/cli/shell/commands/{reports,open,tag}.ts`.
Files to modify: `src/cli/html-report.ts` (export `escapeHtml`), `src/cli/main.ts`
(`hc reports [--json] [--filter TEXT] [--tag T] [--html [--open]]`, `hc open REF`).
Commands: `/reports [TEXT] [--tag T] [--html] [--open]` (stores the listing order),
`/open <n|RC-id|index>`, `/tag [RC-id] add a,b | rm a | title "..."`.
Tests: `tests/cli/reports/gallery.test.ts` (escaping, one link per entry, no author names),
shell command tests (`/open 1` opens `<id>/report.html`, renders when missing, re-renders when
stale, `/open index` writes the gallery, `/tag add` persists), `tests/cli/main.test.ts`
(`hc reports --json` exposes `meta` and no `authorProvider`).
Docs: README "Interactive use" and "Scriptable use"; `docs/hypothesis-council.md` product
contract paragraph (catalog and gallery; meta holds labels, never identities).

### 3.4 Prompt one, several, or all providers

Files to add: `src/cli/shell/providers.ts` (`resolveProviderSelection`, `resolveMention`
by name, nickname, `cli-` stripped, or unique prefix; `splitMentions(line, descriptors)` for
leading and inline `@tokens`, provider mentions win over path mentions),
`src/cli/shell/commands/{ask-all,clear}.ts`.
Files to modify: `src/cli/shell/chat.ts` (`CHAT_NOTICE`, `buildChatPrompt(turns, question,
contextPacket?)`, `askProviders(ctx, providers, question, options)` with `Promise.allSettled`
and per-provider history; session-selected mode calls `service.ask` per provider in parallel;
`replyText` labels each reply with provider, model, and elapsed time),
`src/cli/shell/commands/duck.ts` (`/duck NAME[,NAME] | all | auto`), registry text path, prompt
line `scope · ducks · preset · ctx:n>`.
Tests: `tests/cli/shell/providers.test.ts`, `tests/cli/shell/chat.test.ts` (labels; one
failure does not hide the others; per-provider history isolation; `/clear`; session-grounded
path records distinct call ids).
Docs: README "Interactive use" (`@claude why...`, `/duck all`, `/ask-all`, `/clear`);
`docs/hypothesis-council.md` note that chat is conversational and never feeds council stages.

### 3.5 Context basket, `/repo`, and `@path` mentions

Files to add: `src/cli/shell/basket.ts` (`ContextBasket { paths, snippets, markdownOnly }`,
`addBasketPaths`, `removeBasketPath`, `clearBasket`, `addBasketSnippet` materialising pasted
text as `<home>/basket/<nn>-<label>.md`, `basketPaths`, `buildBasketPacket` via
`buildContextPacket`, `basketPreviewLines`), `src/cli/shell/commands/{context,repo}.ts`,
`src/cli/shell/run-defaults.ts` (`runDefaultsFromState(state)`: repo root, basket paths,
markdown-only, dials; the single place later features extend).
Files to modify: `src/cli/shell/chat.ts` (budget from `calculateContextBudget` minus 8 KiB chat
overhead; preview plus `io.confirm` once per `packetSha256`; non-interactive IO errors with a
hint), `src/cli/shell/commands/run.ts` (defaults from state; explicit flags override).
Commands: `/context` show, `add <path|glob>...`, `add-text LABEL` (block read until a lone
`.`), `rm`, `clear`, `markdown on|off`, `show [--full]`; `/repo [PATH]`.
Tests: `tests/cli/shell/basket.test.ts` (tmp repo fixtures; add, remove, dedupe; snippet
included and kept under markdown-only; `.env` denied; preview lines),
`tests/cli/shell/context-command.test.ts`, chat tests (packet in prompt; confirmation once per
hash; declined confirmation sends nothing), `tests/cli/shell/run-defaults.test.ts`.
Docs: README "Context basket" subsection (commands, mentions, privacy confirmation, pasted
snippets are not secret-filtered); `docs/hypothesis-council.md` persistence paragraph.

### 3.6 Tab completion, help, and the optional `/summarize`

Files: `src/cli/shell/completer.ts` (`createShellCompleter(ctx)` for commands, session ids
after `/use|/open|/tag`, providers after `/duck` and `@`, top-level paths after `@` and
`/context add`), `src/cli/main.ts` passes the completer to readline, `src/cli/shell/help.ts`
ordering. Optional: `src/cli/reports/summary-prompt.ts` and
`src/cli/shell/commands/summarize.ts` (one call to the current selection's first provider from
the public report JSON; saved to `meta.summary`; shown in `/reports` and the gallery).
Tests: `tests/cli/shell/completer.test.ts`; summarize prompt has no provider identities and the
summary persists.
Docs: README "Interactive use" rewritten with the new prompt and a command table.

## 7. Phase 4: research proposal mode

### 4.1 Proposal domain (pure)

Files to add under `src/research/proposal/`:

- `types.ts`: `ProposalStage` (`created | preflight | interviewing | awaiting-answers |
interview-complete | drafting | critiquing | synthesizing | proposed | handoff-prepared |
executing | completed | failed | interrupted`), `ProposalConfig { providers, minProviders,
seed, maxRounds=3, maxQuestionsPerProvider=5, maxQuestionsPerRound=10, interviewVisibility:
sealed|visible, mergeStrategy: synthesize|pick, dials, policy, fromSessionId?, context fields
}`, `InterviewQuestion { id Q-###, round, question, whyItMatters, priority, sources (private),
askedByCount, status: open|answered|skipped|auto-resolved, answer?, resolvedBy?, answeredAt?
}`, `InterviewRound`, `ProposalDraft` (D-### by sorted provider; `authorProvider` private),
  `ProposalCritique` (`reviewerProvider` private), `MergedProposal { source: synthesized|picked,
sourceDraftId?, synthesizerProvider (private), alternatives }`, `HandoffRecord { id X-###,
executor { profile, command, args, model?, promptDelivery }, repositoryPath, transport:
prompt-only|spawned, promptPath, logPath?, resultPath?, status, startedAt, endedAt?,
exitCode?, error? }`, `ProposalSession` (`kind: 'proposal'`, id `RP-<timestamp>-<6hex>`),
  `ProposeInput`, `ProposalPreview`, `ProposalNextAction`.
- `schemas.ts`: `InterviewOutputSchema { questions[], done? }`, `ExperimentStepSchema { step,
title, method, metrics, successCriteria, killCriteria, resources, estimatedEffort, dependsOn?
}`, `ProposalDraftOutputSchema { title, background, hypotheses[{ statement, rationale,
falsifier }], experiments[], risks, dataNeeds, deliverables, openAssumptions? }`,
  `ProposalCritiqueOutputSchema { feasibility, rigor, clarity, completeness, killCriteriaQuality,
fatalGap, strongestObjection, missingSteps, suggestedChanges, verdict, confidence }`,
  `MergedProposalOutputSchema` (draft plus `rationale`, `alternatives[]`).
- `prompts.ts`: `buildInterviewPrompt(topic, packet, ownQaOrTranscript, round, limit, policy)`,
  `buildProposalDraftPrompt`, `buildProposalCritiquePrompt`, `buildProposalSynthesisPrompt`,
  `buildProposalAskPrompt`, `buildExecutorPrompt`, plus repair prompts; all start with the
  version and `NON_INTERACTIVE_NOTICE`. Versions added to `PROMPT_VERSIONS`:
  `proposal-interview:v1`, `proposal-draft:v1`, `proposal-critique:v1`,
  `proposal-synthesis:v1`, `proposal-grounded-ask:v1`, `executor-handoff:v1` and repairs.
- `interview.ts`: `mergeQuestions(session, incoming, round, threshold=0.5)` using
  `clusterBySimilarity` (deterministic ids; a new question matching an answered one becomes
  `auto-resolved`), `visibleQuestions(session, provider, visibility)`, `transcript(session)`
  (no `sources`), `interviewDone`, `nextAction`, `rankDrafts` (fatal gap gate, untestable gate,
  mean of four scores).
- `public.ts`: `publicQuestion`, `publicDraft`, `publicCritique`, `publicProposal`,
  `publicProposalSnapshot`, `createPublicProposalReport`.

Files to modify: `src/research/types.ts` (`ResearchProgress.stage` widened; call stages
`interview`, `proposal-draft`, `proposal-critique`, `proposal-synthesis`, `proposal-ask` and
repairs).

Tests: `tests/research/proposal/interview.test.ts` (deterministic ids, cross-provider merge,
auto-resolve, sealed filtering never leaks another provider's wording),
`tests/research/proposal/prompts.test.ts` (version prefix and notice; no identities in
critique, synthesis, or ask prompts; dial text present), `tests/research/proposal/public.test.ts`.

### 4.2 Proposal service, store, runtime, and report

Files to add: `src/research/proposal/store.ts` (`ProposalSessionStore extends
SessionStoreBase<ProposalSession>` with `RP-` and `current-proposal`),
`src/research/proposal/service.ts` (`preview`, `start` (create, preflight, round 1, stage
`awaiting-answers`), `answer(sessionId, answers)`, `nextRound`, `finishInterview`, `draft`
(drafts then synthesize or pick, writes `proposal.md` and `proposal.json`), `pick`, `ask`,
`resume`), `src/research/proposal/report.ts` (`renderProposalMarkdown`,
`renderTranscriptMarkdown` using only constructs the HTML renderer supports).
Files to modify: `src/runtime.ts` (`proposals: ResearchProposalService` on `CouncilRuntime`).
Barrier mechanics: round-1 prompt is one string for all providers; sealed rounds build
per-provider prompts from that provider's own questions; providers that declared done are not
re-asked; the draft prompt is one string for all providers; the synthesizer is
`providers[stableHash(seed:id) % n]` and receives public drafts in id order.
Seeding from a council session: `ProposeInput.fromSessionId` loads that `RC-` session, projects
its ranked distinct candidates through `publicCandidate` (title, claim, mechanism, predictions,
falsifier, minimal experiment, review verdict; no author or reviewer labels), stores them as
`session.priorFindings`, and adds a `PRIOR COUNCIL FINDINGS` block to the round-1 interview
prompt and the draft prompt. The block says the findings are inputs to build on or refute, not
conclusions to restate. The council session id is recorded in `config.fromSessionId` and in the
proposal report.
Session directory: `session.json`, `context-packet.txt`, `context-manifest.json`, `calls/`,
`transcript.md`, `proposal.md`, `proposal.json`, `handoff/X-###/`.
Tests: `tests/research/proposal/service.test.ts` with a `ScriptedProposalGateway` (round-1
prompts identical and containing the packet; sealed round-2 prompt excludes the other
provider's wording, visible mode includes it; ids `Q-001..`; auto-resolve; `done` moves to
`interview-complete`; draft prompts identical; deterministic synthesizer; `proposal.json` has
no private keys; raw artifacts under `calls/interview/`; cwd contains the RP id; abort leaves
`awaiting-answers` plus `interrupted` and `resume` continues; `pick` and `mergeStrategy: pick`;
seeded from an `RC-` session, the round-1 and draft prompts contain the candidate titles and no
`authorProvider` or `reviewerProvider`).

### 4.3 CLI and shell for proposals

Files to add: `src/cli/propose.ts` (`createProposeInput`, `questionListText`,
`proposalSummaryText`, `proposalStatusText`, `proposalsListText`, `runProposeCommand`),
`src/cli/interview.ts` (`LineSource`, `runInterviewLoop(service, sessionId, io, opts)`
accepting free text, `skip`, `/done`, `/later`, `/next`, an answers file, and `--no-interview`),
`src/cli/shell/commands/{propose,proposals,next,done,draft,pick,proposal}.ts`.
Files to modify: `src/cli/main.ts` (`hc propose "<topic>" [--repo] [--context]...
[--providers] [--preset] [--min-providers] [--max-rounds N] [--visible-council] [--merge
pick|synthesize] [--from RC-id|current] [--answers FILE] [--no-interview] [--yes] [--json]`
(`--from current` uses the shell's selected council session) and subcommands `list`,
`status`, `show D-001`, `report [--json|--html|--open|--out]`, `resume`, `pick`, `ask`),
`src/cli/shell/context.ts` (`selectedProposal`, `lineCapture` checked first in the line
handler; prompt `RP-...[Q-003]>` while answering), `/use RP-...` routing, plain text with a
selected proposal calls `proposals.ask`, `src/cli/format.ts` error hints.
Tests: `tests/cli/interview.test.ts` (scripted `LineSource`: answer, skip, `/done`, answers
file, abort leaves `awaiting-answers`), `tests/cli/propose.test.ts` (renderers hide identities;
input defaults), run-options extension.
Docs: README "Research proposals"; `docs/hypothesis-council.md` "Proposal workflow" (stages,
sealed-interview rule, cost table `interview <= N x rounds`, `drafts N`, `critiques N`,
`synthesis 1`).

### 4.4 Blinded critique feeding synthesis

Files: `src/research/proposal/service.ts` (`critique()` between drafting and synthesis using
`assignReviewers(drafts, providers, seed + 2)`, non-author, one critique per draft, ranking via
`rankDrafts`), `prompts.ts` (synthesis prompt includes public critiques and must preserve
rework or reject dissent as alternatives), `report.ts` (critique summary per draft), `public.ts`.
Tests: critiques never self-review; critique prompts carry no provider names; synthesis prompt
contains each `strongestObjection`; a draft with a fatal gap ranks last; resume after an abort
mid-critique re-runs only pending critiques.

### 4.5 Handoff bundle and prompt-only handoff

Files: `src/research/proposal/handoff.ts` (`prepareHandoff(store, session, { repositoryPath,
executorLabel, model? })` writes `handoff/X-###/{proposal.md, transcript.md,
context-manifest.json, executor-prompt.md}` and appends a `prompt-only` record),
`prompts.ts` `buildExecutorPrompt` (role, absolute repo path, proposal, transcript, file list
from the manifest, rules: branch `hc/<RP-id>`, never push, force, or reset, log every command,
stop at kill criteria; fixed report block delimited by `===== HC EXECUTOR REPORT BEGIN/END
=====` with Summary, Step results, Deviations, Artifacts, Open questions), CLI `hc propose
handoff [RP] --to claude|codex|NAME [--repo PATH] [--model M] [--print|--out PATH]` and
`/handoff <executor> [--repo PATH]`.
Tests: `tests/research/proposal/handoff.test.ts` (bundle files exist; prompt contains the
title, every answered pair, the repo path, and the delimiters; no identities; record persisted).
Docs: README handoff section; `docs/hypothesis-council.md` handoff contract.

### 4.6 Live executor

Files to add: `src/executor/types.ts`, `src/executor/profiles.ts`
(`resolveExecutorLaunch(name, env, { model?, timeoutMs, mode })`; built-ins as table data,
full auto by default: claude `-p --output-format text --dangerously-skip-permissions
--max-turns 400 [--model M]` via stdin; codex `exec --skip-git-repo-check
--dangerously-bypass-approvals-and-sandbox [--model M] -` via stdin; agy
`--dangerously-skip-permissions [--model M]` through the stream-json shim; grok through the
prompt-file shim with its approval-bypass flag if `grok --help` offers one, otherwise its least
restrictive sandbox profile. Verify every flag against the installed CLI's `--help` before
merging and keep them as table data. `HYPOTHESIS_COUNCIL_EXECUTOR_MODE=full-auto|sandboxed`
(default `full-auto`; `sandboxed` uses `--permission-mode acceptEdits` with an allowed-tool
list for Claude and `--sandbox workspace-write` for Codex); custom
`HYPOTHESIS_COUNCIL_EXECUTOR_<NAME>_COMMAND|_ARGS|_PROMPT_DELIVERY|_MODEL_FLAG`),
`src/executor/run.ts` (`runExecutor(launch,
prompt, { cwd, logPath, onLine, signal, timeoutMs })` following the stdin-shim `runChild`
pattern; process-group kill on POSIX, `taskkill /pid N /T /F` on Windows; streams lines to
`executor.log`; extracts the delimited report; default timeout 2 h via
`HYPOTHESIS_COUNCIL_EXECUTOR_TIMEOUT_MS`).
Files to modify: CLI `hc propose handoff --run [--yes] [--timeout-ms N]` and `/handoff ...
--run` (refuse a missing repo or the session home as cwd; refuse a dirty git working tree unless
`--allow-dirty`; print executor, mode, model, exact command, cwd, and git branch; the
confirmation states that the executor runs without approval prompts and can modify or delete
files under the repository; y/N unless `--yes`; persist `running` before spawn; progress line
`[executing]`; persist `result.md` and status; Ctrl-C kills the tree). The executor model comes
from the Phase 2 resolver. `CLAUDE.md` gains the rule that `src/executor/` is the only
module that spawns vendor CLIs directly, always with a user-confirmed repository as cwd, never
imported by `src/research/`, MCP-free.
Tests: `tests/executor/profiles.test.ts` (full-auto and sandboxed argument tables, custom env,
model flag), `tests/executor/run.test.ts` with `process.execPath`
fake scripts (report extracted; non-zero exit; sleeping script plus abort ends `interrupted`
within the timeout; log written; cwd honoured).
Docs: README "Running the executor"; `docs/hypothesis-council.md` safety section.

### 4.7 Optional MCP tools

`src/server.ts`: `duck_research_proposal` (topic, context, `no_interview?`, `answers?`),
`duck_research_proposal_answer`, `duck_research_proposal_report`. Handoff execution is not
exposed over MCP. Update `tests/server.test.ts` and `docs/tools.md`.

## 8. Phase 5: sources and web scouting

### 5.1 Sources stage from a user-supplied file, verified mechanically

Files to add: `src/research/sources.ts` (`SourceRecord { id S-###, title, url, doi?, year?,
venue?, summary?, origin: user|scout, kindHint, verification?, critique? }`,
`parseSourcesFile` for JSON `{ sources: [] }` or Markdown bullets, `normalizeSources` with
canonical URL and DOI dedupe, `renderSourcesSection` producing the `===== SOURCES =====` block
with scout summaries labelled model-written and unverified, `sourcesSectionBytes`),
`src/research/source-verify.ts` (`SourceVerifier` interface;
`createFetchSourceVerifier(fetchImpl, { timeoutMs 10000, maxBytes 262144, concurrency 4,
maxRedirects 5 })` using Node 20 global fetch, denying non-http schemes, localhost, RFC1918 and
link-local hosts, recording status, final URL, content type, SHA-256, title-found, fetched-at;
`checkRetraction(doi)` via Crossref only at the fetch-plus-retraction policy; offline yields
`skipped`).
Files to modify: `src/research/schemas.ts` (basis `source`, `sourceId?`),
`src/research/evidence.ts` (`source` basis verified only when its record is reachable and not
retracted; `context` quotes are matched against the file packet only),
`src/research/context.ts` (`appendix?` option so budget, `packetBytes`, and `packetSha256`
cover the section; manifest `appendixBytes`), `src/research/store.ts`
(`sources-section.txt`, `sources.json`), `src/research/orchestrator.ts` (stage `sourcing`
after preflight; injected verifier via a constructor option wired in `src/runtime.ts`; drops
per policy; generation prompt is the file packet plus section), `src/research/types.ts`
(`SourcesConfig`, `ResearchSession.sources?`, `RunResearchInput.sourcesFile?`),
`src/research/report.ts` (`## Sources` table; weak-claims section lists unverified citations),
CLI `--sources`, MCP `sources_file`, preview line stating how many URLs will be fetched from
this machine.
Tests: `tests/research/sources.test.ts`, `tests/research/source-verify.test.ts` with a fake
fetch (200, 404, timeout, oversize, redirect chain, blocked host, stable hash, retraction parse,
`skipped`), `tests/research/evidence.test.ts`, `tests/research/context.test.ts` (appendix inside
the budget and the hash), orchestrator tests (identical `SOURCES` block in every generation
prompt; persisted; resume rebuilds the same prompt; report section).
Docs: README "Sources" (formats, what is fetched, `--sources`); `docs/hypothesis-council.md`
"Sources stage" and a rewrite of later-slice item 9 to the reconciled policy (retrieval is a
separate pre-generation stage with identical output for all generators).

### 5.2 Web scouting through web-enabled provider profiles

Files to add: `src/rubber-duck/scout-profiles.ts` (`scoutProfileEnvironment(vendor,
{ execPath, shimPath, model?, reasoningEffort?, timeoutMs, maxTurns = 12 })` returning
`CLI_CUSTOM_<VENDOR>_SCOUT_*`; base arg builders `claudeBaseArgs(model)` and
`codexBaseArgs(model, effort)` extracted from `launch.ts`; constants `CLAUDE_SCOUT_TOOLS =
'WebSearch,WebFetch'` with `--restricted`, `CODEX_WEB_SEARCH_CONFIG` defaulting to
`web_search="live"` and overridable with `HYPOTHESIS_COUNCIL_CODEX_WEB_SEARCH_CONFIG`; grok
scout omits `--disable-web-search`).
Files to modify: `src/research/prompts.ts` (`WEB_SCOUT_NOTICE`, `source-scout:v1`,
`buildSourceScoutPrompt(goal, manifestPaths, { count, avoidUrls })`), `src/research/schemas.ts`
(`SourceScoutOutputSchema`), `src/cli/presets.ts` (`CouncilPreset.scouts?`; `frontier` adds the
three scouts, `quick` adds claude and codex scouts; scout env built after model resolution so
scout and council models match), `src/research/orchestrator.ts` (`prepare` excludes scouts from
the default council and rejects a scout listed as a council provider; scouts run in parallel,
rounds sequential; scouts receive the goal and manifest paths only; failures are warnings),
`src/research/types.ts` (`RunResearchInput.scouts?`, `web?`; preview `sourcesPlan`),
`src/cli/doctor.ts` (`WEB` column derived from args; problem line when a council provider has
web enabled), CLI `--scouts`, `--web`, MCP inputs, preview text.
Tests: `tests/rubber-duck/scout-profiles.test.ts` (exact arg strings; council grok has
`--disable-web-search`), `tests/cli/presets.test.ts`, orchestrator tests (a listed
`duck-scout` is excluded from the default council; scout prompt has the goal and manifest paths
but no file text; scouted sources verified through a fake verifier; every generation prompt is
identical and contains `S-001`; failing scout leaves a warning; `web: off` skips the stage),
`tests/cli/doctor.test.ts`.
Docs: README "Web scouting" (what leaves the machine, how to disable, adding scouts);
`docs/hypothesis-council.md`; `docs/tools.md`.

### 5.3 Source-critique call

Files: `src/research/prompts.ts` (`source-critique:v1`; output per source `{ id, kind,
reliability 1-10, replication, concerns }`), `src/research/schemas.ts`,
`src/research/orchestrator.ts` (one call per batch of at most 20 sources to a council provider
chosen by stable hash of the seed; merged into `session.sources[].critique`; failure is a
warning), `src/research/sources.ts` (section shows model-assessed reliability as unverified),
`src/research/ranking.ts` (at skepticism 8 or above, `source` evidence with reliability below
4 or `contested` counts as unsupported), `src/research/report.ts` (kind, reliability,
concerns; critic provider stripped).
Tests: orchestrator (critique only at skepticism 5 or above with sources; merged; no provider
names in `report.json`), `core.test.ts`, `prompts.test.ts`.
Docs: README and `docs/hypothesis-council.md` "Source critique" paragraph.

## 9. Phase 6: documentation and guidance sweep

Done on 2026-09-04; the list below is what the sweep covered.

- README: rewrite "Interactive use" with the new prompt and command table; add "Settings",
  "Novelty and skepticism dials", "Model selection", "Context basket", "Research proposals",
  "Sources", "Web scouting"; update the preset table (`frontier` is latest-resolved with the
  pinned fallback list; mention `HYPOTHESIS_COUNCIL_MODEL_POLICY=pinned`).
- `docs/hypothesis-council.md`: package-boundary paragraph on `list_models` and `ask_duck`
  model limits; dials; sources stage; proposal workflow; executor safety; test-contract bullets.
- `docs/tools.md`: new MCP inputs and tools.
- `CLAUDE.md`: model discovery and selection live in `src/cli/` and spawn only read-only listing
  commands; no vendor secrets in the Hypothesis Council cache; `src/executor/` boundary rule;
  settings schema lives in `src/research/settings.ts`.

## 10. Decisions resolved on 2026-09-04

1. **Codex context window (2.4).** Trust the discovered `context_window`, 272,000 tokens for
   `gpt-5.6-sol`, instead of the preset's 1,050,000. The
   `HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX` override still wins when set.
2. **Gemini choice (2.1).** Use the newest release: Gemini ranks version first, so
   `gemini-3.8-flash-high` is selected over `gemini-3.1-pro-high`.
   `HYPOTHESIS_COUNCIL_MODEL_FAMILY_GEMINI=pro` restores pro-first. The AGY pinned fallback
   becomes `gemini-3.8-flash-high`.
3. **Executor permissions (4.6).** Full auto for every executor that offers a non-interactive
   bypass flag; `HYPOTHESIS_COUNCIL_EXECUTOR_MODE=sandboxed` is the opt-out. The launch
   confirmation shows the exact command and the CLI refuses a dirty working tree unless
   `--allow-dirty`.
4. **Scout input scope (5.2).** Scouts receive the goal and manifest paths only; repository
   contents never reach a web-enabled profile, and the preview says so.
5. **Seeding proposals from a council session (4.2, 4.3).** Included: `--from RC-id` and
   `--from current` add a `PRIOR COUNCIL FINDINGS` block, projected without provider labels,
   to the interview and draft prompts.
6. **Codex web-search key (5.2).** Ship `-c web_search="live"` as an environment-overridable
   constant and verify it with `hc doctor --probe` on the scout profile once the step lands;
   switch to `features.web_search_request=true` if the probe shows no search.

## 11. Risks

- Prompt version bumps (1.2) break the `ScriptedGateway` prefix matching; update the fakes in
  the same step.
- Vendor caches hold secrets (`~/.grok/models_cache.json` `api_key`, `~/.claude.json`
  `oauthAccount`); discovery whitelists fields and a test asserts the HC cache never contains
  them.
- Listing commands need network and auth; they must degrade to cache or curated values within
  the timeout and never block `hc run`.
- Model-supplied URLs can point at intranet hosts; the verifier denies private ranges and caps
  bytes, time, and redirects.
- The readline `lineCapture` hook (4.3) is the main double-handling risk; keep it the first
  statement of the line handler and test the loop with a fake `LineSource`.
- Full-auto executors can modify or delete files in the target repository. The CLI requires a
  clean working tree unless `--allow-dirty`, the executor prompt mandates a `hc/<RP-id>` branch
  and forbids push, force, and reset, and the confirmation shows the exact command line.
- Cost at dials 10/10 on `frontier`: scouts 3 x 2 rounds, 4 extra generation calls, up to
  4 x (3 + 1) reviews, 2 x topK falsifications; the preview must show planned calls.
- `applyPreset` mutates `process.env`; the environment snapshot at startup (2.5) is what makes
  repeated `/preset` calls and explicit-override detection correct.
- Coverage is collected; the bin file shrinks, so the shell loop in `main.ts` must stay thin
  and everything below it tested.
