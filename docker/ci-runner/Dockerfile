# The runner image of the hybrid strategy's container slots (§ 8 PLX-Delivery):
# the official runner image plus what the forge-side jobs expect of GitHub's
# runners and the official image leaves out. One container runs one job and
# is removed after it (ci_hybrid_host); nothing here is a cache or a secret.
# Built and pushed by runner-image.yml as ghcr.io/plexus-ms/ci-runner at the
# train number, with provenance; Renovate moves the base.
#
# The tools the jobs install themselves (mise and what it pins, exo, crane,
# the 1Password CLI) stay the jobs' business: a slot runs the same steps as
# a GitHub runner, and a version here would be a second pin of each.
FROM ghcr.io/actions/actions-runner:2.338.2@sha256:759a1d94a15b05941aba5196974ff43fe15b4cbba29b694b35cbc32a1166b232

USER root
# git for actions/checkout (without it the action downloads a tarball and
# later git commands fail), jq and unzip for the jobs' own steps and the
# 1Password action, zstd for the cache actions, gnupg for apt keys.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg jq unzip zstd \
 && rm -rf /var/lib/apt/lists/*
USER runner
WORKDIR /home/runner
