#!/bin/zsh
cd "${0:A:h}"
BOO_NODE=$(command -v node)
if [[ -z "$BOO_NODE" ]]; then
  BOO_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$BOO_NODE" ]]; then
  echo "Please install Node.js 22 or newer, then follow README.md."
  read
  exit 1
fi
export PATH="${BOO_NODE:h}:$PATH"
echo "Boo Ballot starts at http://localhost:5173. Keep this window open."
"$BOO_NODE" scripts/run-framework.mjs dev
