# Hypothesis Council repository guidance

## Architecture

- `src/research/` owns the hypothesis workflow and must remain independent of MCP SDK and terminal
  presentation details.
- `src/rubber-duck/` is the only integration boundary with the installed `mcp-rubber-duck`
  package. Use its public MCP tools; do not import package internals.
- `src/runtime.ts` owns the lifetime of session-scoped Rubber Duck subprocesses.
- `src/cli/` and `src/server.ts` are presentation adapters over the shared research service.
  Council presets (`src/cli/presets.ts`) and `hc doctor` are CLI concerns; they configure
  Rubber Duck through its public environment variables only.
- `src/executor/` is the only module that spawns vendor CLIs directly (the research-proposal
  handoff runs one executor with repository access there); `src/research/` never imports it,
  and executor profiles are configured through `HYPOTHESIS_COUNCIL_EXECUTOR_*` variables only.
- Model discovery and selection (`src/cli/model-discovery.ts`, `src/cli/model-selection.ts`) are
  CLI concerns. Discovery reads vendor catalog files field by field and spawns only read-only
  listing commands; vendor credentials are never copied into the council's model cache.
- The settings schema lives in `src/research/settings.ts`; `src/cli/settings-command.ts` maps
  flags and environment variables onto it with the precedence flag > environment > file > default.
- Web scouts (`src/rubber-duck/scout-profiles.ts`) are Rubber Duck custom CLI providers named
  `*_scout` or `*-scout`. The name is the contract: such a provider is web-enabled, runs only in
  the sources stage, and is never seated on the council. The per-record `scoutProvider` field is
  private and must be stripped from public output.
- `src/rubber-duck/stdin-shim.ts` is a vendor-CLI wrapper Rubber Duck launches for CLIs that
  cannot read a prompt from stdin; it must stay dependency-free and testable through
  `stdin-shim-core.ts` with fake commands.

## Conventions

- The project is TypeScript ESM; relative imports include `.js` extensions.
- Every new component requires focused unit tests under the matching `tests/` path.
- Tests must use fake providers or in-memory/fake MCP peers and must not contact live models.
- Preserve the independence barrier: initial provider outputs cannot influence other initial prompts.
- Public status, report, and CLI JSON must not expose author or reviewer provider identities.
- Provider processes run with a session directory as their working directory.

## Merge gate

```bash
npm run check   # = npm run typecheck && npm run lint && npm test -- --runInBand && npm run build
```

Two package-contract tests are skipped on Windows by design (fake `codex`/`claude` scripts cannot
shadow the real executables there); everything else must pass on every platform.

Do not commit without user approval.
