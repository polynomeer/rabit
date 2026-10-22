#!/bin/sh
# Kept for old instructions: builds the demo catalog set(s) from infra/demo/catalog/*.json.
#   sh infra/demo/generate-catalog.sh             → core and expansion
#   sh infra/demo/generate-catalog.sh core        → one set
# Output: infra/demo/out/<set>/manifest.json (see infra/demo/README.md).
set -eu
cd "$(dirname "$0")"
[ "$#" -eq 0 ] && set -- core expansion
for set in "$@"; do node generate.mjs "$set"; done
