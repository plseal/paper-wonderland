#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (GitHub Pages).
set -euo pipefail
npm run build
tmp=$(mktemp -d); cp -r dist/. "$tmp"; touch "$tmp/.nojekyll"
cd "$tmp" && git init -q -b gh-pages && git add -A && git commit -qm "Deploy $(date -u +%FT%TZ)"
git push -f https://github.com/plseal/paper-wonderland.git gh-pages
