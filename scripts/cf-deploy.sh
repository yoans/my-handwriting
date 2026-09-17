#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/css" "$STAGE/js"
cp "$ROOT/index.html" "$ROOT/favicon.svg" "$ROOT/og-image.jpg" "$STAGE/"
cp "$ROOT/css/style.css" "$STAGE/css/"
cp "$ROOT/js/"*.js "$STAGE/js/"
npx wrangler deploy --config "$ROOT/wrangler.toml" --assets "$STAGE"
