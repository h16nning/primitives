#!/usr/bin/env bash
# Links the four collections under .ansible/collections, the project-local
# collections path ansible-lint and the syntax checks read first, so that a
# plexus.* collection installed user-wide (a tenant's pin) never shadows the
# checkout. Idempotent; .ansible/ is ignored by git.
set -euo pipefail
cd "$(dirname "$0")/.."
target=.ansible/collections/ansible_collections/plexus
mkdir -p "$target"
for dir in ansible/*/; do
  name=$(basename "$dir")
  ln -sfn "../../../../ansible/$name" "$target/$name"
done
