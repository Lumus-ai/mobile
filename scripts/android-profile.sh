#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p poc
cp embedded/rebuild-kit/opp-rebuild-kit/poc/build.ts poc/build.ts
cp embedded/rebuild-kit/opp-rebuild-kit/poc/stage.ts poc/stage.ts
# Existing source adapters are versioned; don't overwrite alpha server/core changes.
for pkg in sql.js jsonc-parser web-tree-sitter tree-sitter-bash tree-sitter-powershell; do
  loc=$(find node_modules/.bun -maxdepth 3 -type d -path "*/node_modules/$pkg" -print -quit)
  if [ -n "$loc" ] && [ ! -e "node_modules/$pkg" ]; then ln -s "${loc#node_modules/}" "node_modules/$pkg"; fi
done
PROFILE=android bun poc/build.ts
bun poc/stage.ts

python3 scripts/android-noicu.py poc/stage/server

find poc/stage/server -type f -name "*.map" -delete
