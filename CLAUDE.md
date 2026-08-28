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
