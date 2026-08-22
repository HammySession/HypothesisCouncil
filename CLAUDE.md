# Hypothesis Council repository guidance

## Architecture

- `src/research/` owns the hypothesis workflow and must remain independent of MCP SDK and terminal
  presentation details.
- `src/rubber-duck/` is the only integration boundary with the installed `mcp-rubber-duck`
  package. Use its public MCP tools; do not import package internals.
- `src/runtime.ts` owns the lifetime of session-scoped Rubber Duck subprocesses.
- `src/cli/` and `src/server.ts` are presentation adapters over the shared research service.

## Conventions

- The project is TypeScript ESM; relative imports include `.js` extensions.
- Every new component requires focused unit tests under the matching `tests/` path.
- Tests must use fake providers or in-memory/fake MCP peers and must not contact live models.
- Preserve the independence barrier: initial provider outputs cannot influence other initial prompts.
- Public status, report, and CLI JSON must not expose author or reviewer provider identities.
- Provider processes run with a session directory as their working directory.

## Merge gate

```bash
npm run typecheck && npm run lint && npm test -- --runInBand && npm run build
```

Do not commit without user approval.
