#!/bin/sh
# Creates private buckets (ADR-0004). No bucket gets a public policy.
set -eu
mc alias set local http://minio:9000 rabit rabit-dev-secret >/dev/null
for b in rabit-quarantine rabit-private-originals rabit-private-media \
         rabit-catalog-originals rabit-catalog-media rabit-exports; do
  mc mb --ignore-existing "local/$b" >/dev/null
  mc anonymous set none "local/$b" >/dev/null
done
# Backstop lifecycle: abandoned quarantine objects and exports expire.
mc ilm rule add --expire-days 2 local/rabit-quarantine >/dev/null 2>&1 || true
mc ilm rule add --expire-days 2 local/rabit-exports >/dev/null 2>&1 || true
echo "buckets ready"
