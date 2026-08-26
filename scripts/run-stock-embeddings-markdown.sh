#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
DEFAULT_STOCK_REPOSITORY="$(cd "${PROJECT_DIRECTORY}/.." && pwd)/stock_embeddings"
STOCK_REPOSITORY="${STOCK_EMBEDDINGS_REPO:-${DEFAULT_STOCK_REPOSITORY}}"

if [[ ! -d "${STOCK_REPOSITORY}" ]]; then
  echo "stock_embeddings repository not found: ${STOCK_REPOSITORY}" >&2
  echo "Set STOCK_EMBEDDINGS_REPO to its absolute path." >&2
  exit 1
fi
STOCK_REPOSITORY="$(cd "${STOCK_REPOSITORY}" && pwd)"

for provider_command in agy claude codex grok; do
  if ! command -v "${provider_command}" >/dev/null 2>&1; then
    echo "Required provider CLI is not on PATH: ${provider_command}" >&2
    exit 1
  fi
done

if command -v hc >/dev/null 2>&1; then
  HC_COMMAND=(hc)
elif [[ -f "${PROJECT_DIRECTORY}/dist/cli/hypothesis-council.js" ]]; then
  HC_COMMAND=(node "${PROJECT_DIRECTORY}/dist/cli/hypothesis-council.js")
else
  echo "Hypothesis Council is not built. Run 'npm run build' and 'npm link'." >&2
  exit 1
fi

# Grok expert profile: Grok 4.6 with extra-high reasoning.
unset CLI_GROK_ENABLED || true
export CLI_CUSTOM_GROK_COMMAND='grok'
export CLI_CUSTOM_GROK_PROMPT_DELIVERY='flag'
export CLI_CUSTOM_GROK_PROMPT_FLAG='-p'
export CLI_CUSTOM_GROK_OUTPUT_FORMAT='text'
export CLI_CUSTOM_GROK_DEFAULT_MODEL='grok-4.6'
export CLI_CUSTOM_GROK_NICKNAME='Grok Expert'
export CLI_CUSTOM_GROK_CLI_ARGS='-m,grok-4.6,--reasoning-effort,xhigh'

# Extra-high reasoning can legitimately take several minutes. Rubber Duck subprocesses receive
# fifteen minutes, and the MCP request layer automatically adds one minute of shutdown headroom.
export HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS="${HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS:-900000}"
export CLI_CUSTOM_GROK_PROCESS_TIMEOUT="${HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS}"

# Gemini thinking profile through Google Antigravity (AGY), not Gemini CLI.
unset CLI_GEMINI_ENABLED || true
export CLI_CUSTOM_AGY_COMMAND='agy'
export CLI_CUSTOM_AGY_PROMPT_DELIVERY='flag'
export CLI_CUSTOM_AGY_PROMPT_FLAG='-p'
export CLI_CUSTOM_AGY_OUTPUT_FORMAT='json'
export CLI_CUSTOM_AGY_DEFAULT_MODEL='gemini-3.1-pro-high'
export CLI_CUSTOM_AGY_NICKNAME='Gemini Thinking'
export CLI_CUSTOM_AGY_PROCESS_TIMEOUT="${HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS}"
export CLI_CUSTOM_AGY_CLI_ARGS='--output-format,json,--model,gemini-3.1-pro-high,--effort,high,--sandbox'
export HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_AGY='1000000'

# Claude Fable with its one-million-token context profile.
export CLI_CLAUDE_ENABLED=true
export CLI_CLAUDE_DEFAULT_MODEL='claude-fable-5[1m]'
export HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE='1000000'

# GPT-5.6 Sol with extra-high reasoning.
export CLI_CODEX_ENABLED=true
export CLI_CODEX_DEFAULT_MODEL='gpt-5.6-sol'
export HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT='xhigh'
export HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX='1050000'

echo "Repository: ${STOCK_REPOSITORY}" >&2
echo "Context: Markdown and MDX only" >&2
echo "Council: Grok 4.6 xhigh, Gemini 3.1 Pro High via AGY, Claude Fable 5, GPT-5.6 Sol xhigh" >&2

exec "${HC_COMMAND[@]}" run \
  --repo "${STOCK_REPOSITORY}" \
  --markdown-only \
  --providers 'cli-grok,cli-agy,cli-claude,cli-codex' \
  --min-providers 4 \
  "$@"
