#!/usr/bin/env bash
# Fails when a role under ansible/<collection>/roles is not listed in tests/all-roles.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

missing=0
for dir in ansible/*/roles/*/; do
  collection=$(basename "$(dirname "$(dirname "$dir")")")
  role=$(basename "$dir")
  if ! grep -qx "    - plexus.$collection.$role" tests/all-roles.yml; then
    echo "✗ role plexus.$collection.$role is not listed in tests/all-roles.yml" >&2
    missing=1
  fi
done
exit "$missing"
