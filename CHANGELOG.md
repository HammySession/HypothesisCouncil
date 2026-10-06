# Changelog

## 0.1.0 (2026-10-05)

First public release.

### What it does

- Independent hypothesis generation across several AI coding CLIs (Claude Code, Codex, Grok,
  Gemini through the Antigravity CLI), with a sealed context packet that every provider receives
  unchanged and that nobody sees another's output during.
- Mechanical evidence verification: context quotes are checked against the packet by the harness,
  not by a model; every hypothesis must state what it predicts that the consensus does not.
- Blind review by a non-author, graded falsifiers (an untestable falsifier sinks a hypothesis
  below every testable one), consensus-crowding measurement, and adversarial falsification of the
  finalists.
- Novelty and skepticism dials that change prompts, extra calls, and ranking rules, and are
  recorded in every report.
- A sources stage: a sources file plus web scouts, fetched and graded before generation, cited by
  id from the packet.
- Research proposals: a sealed council interview, independent drafts, blind critiques, one merged
  proposal, and a handoff bundle an executor CLI can carry out in the repository.
- An interactive shell with provider chat, a context basket, a report catalog with tags and an
  HTML gallery, and the same commands as the CLI.
- Markdown, JSON, and HTML reports; sessions persisted locally with atomic checkpoints and
  `hc resume`.
- A standalone MCP server (`hypothesis-council-mcp`) exposing the council and proposal tools.

### Setup

- `hc` seats whichever of Claude Code and Codex are installed when no preset or provider is
  configured (the `auto` preset), so a fresh install needs no environment variables.
- `hc doctor` reports a missing CLI with an install hint instead of a Rubber Duck start-up error.
- `hc --help`, `hc -h`, `hc --version`, and `hc version` work.
- The Rubber Duck subprocess logs at `warn` level unless `LOG_LEVEL` is set.
- `npm install` from a clone builds the project; the published package ships `dist/` and the
  docs only.
