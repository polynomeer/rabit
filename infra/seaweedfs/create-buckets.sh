#!/bin/sh
# Creates the private buckets (ADR-0004) on the local SeaweedFS S3 gateway.
# Buckets have no anonymous access: SeaweedFS S3 requires a signed request
# from an identity in s3.json. Safe to re-run.
# Usage: create-buckets.sh [master host:port]   (default: s3:9333)
set -eu
master="${1:-s3:9333}"
{
  for b in rabit-quarantine rabit-private-originals rabit-private-media \
           rabit-catalog-originals rabit-catalog-media rabit-exports; do
    echo "s3.bucket.create -name $b"
  done
  # Backstop lifecycle: abandoned quarantine objects and exports expire (2 days).
  echo "fs.configure -locationPrefix=/buckets/rabit-quarantine/ -ttl=2d -apply"
  echo "fs.configure -locationPrefix=/buckets/rabit-exports/ -ttl=2d -apply"
} | weed shell -master="$master" >/dev/null
echo "buckets ready"
