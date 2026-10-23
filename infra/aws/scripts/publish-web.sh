#!/usr/bin/env bash
# Publishes the web client (ADR-0011) without breaking open tabs: hashed assets
# are uploaded first and kept, index.html last and uncached, then the CDN is
# invalidated. Assets older than KEEP_DAYS (default 14) are pruned, so a tab
# opened before this deploy can still load the chunks it asks for.
#
# Usage: publish-web.sh <dist dir> <bucket> <cloudfront distribution id>
set -euo pipefail
DIST=${1:?dist dir}
BUCKET=${2:?bucket}
DISTRIBUTION=${3:?distribution id}
KEEP_DAYS=${KEEP_DAYS:-14}

# Content-hashed files never change under their name.
aws s3 sync "$DIST/assets" "s3://$BUCKET/assets" --exclude '*.map' \
  --cache-control 'public, max-age=31536000, immutable'
# Icons and the manifest keep their names: short cache, replaced in place.
aws s3 sync "$DIST" "s3://$BUCKET" --exclude 'assets/*' --exclude index.html \
  --cache-control 'public, max-age=3600'
aws s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*' >/dev/null

# Prune old hashed assets (never index.html), oldest first, in batches of 1000.
cutoff=$(date -u -d "-${KEEP_DAYS} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
  date -u -v-"${KEEP_DAYS}"d +%Y-%m-%dT%H:%M:%SZ)
aws s3api list-objects-v2 --bucket "$BUCKET" --prefix assets/ \
  --query "Contents[?LastModified<'$cutoff'].Key" --output json |
  jq -c 'if . == null then [] else . end | _nwise(1000) | {Objects: map({Key: .}), Quiet: true}' |
  while read -r batch; do
    aws s3api delete-objects --bucket "$BUCKET" --delete "$batch" >/dev/null
  done
echo "published web client to $BUCKET (kept assets newer than $KEEP_DAYS days)"
