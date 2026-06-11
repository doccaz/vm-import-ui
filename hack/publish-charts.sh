#!/usr/bin/env bash
# Package every chart under charts/ and publish the .tgz + index.yaml to the
# gh-pages branch, which GitHub Pages serves as a Helm repo. Charts are NOT
# published as GitHub Releases — the Releases page is reserved for app versions.
#
# Env:
#   PAGES_URL  Base URL of the Helm repo (default: the project's GitHub Pages site)
set -euo pipefail

PAGES_URL="${PAGES_URL:-https://doccaz.github.io/vm-import-ui}"

git config user.name "${GIT_USER:-github-actions[bot]}"
git config user.email "${GIT_EMAIL:-github-actions[bot]@users.noreply.github.com}"

# Check out gh-pages in a separate worktree so historical .tgz files are kept.
git fetch origin gh-pages
rm -rf /tmp/ghp
git worktree add /tmp/ghp gh-pages

# Package every chart into the gh-pages worktree.
for chart in charts/*/; do
  [ -f "${chart}Chart.yaml" ] || continue
  helm package "$chart" --destination /tmp/ghp
done

# (Re)generate the repo index. Merge with the existing one when present so the
# original "created" timestamps of prior versions are preserved.
if [ -f /tmp/ghp/index.yaml ]; then
  helm repo index /tmp/ghp --url "$PAGES_URL" --merge /tmp/ghp/index.yaml
else
  helm repo index /tmp/ghp --url "$PAGES_URL"
fi

cd /tmp/ghp
git add -A
if git diff --cached --quiet; then
  echo "No chart changes to publish."
else
  git commit -m "Publish Helm charts ($(date -u +%FT%TZ))"
  git push origin gh-pages
fi
