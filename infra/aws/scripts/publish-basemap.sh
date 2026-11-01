#!/usr/bin/env bash
# Publishes the DIG map base (ADR-0038): an OpenStreetMap vector tile extract (Protomaps
# basemap, PMTiles) and its glyphs, served next to the web client under /map/v1/.
# Nothing finer than city level is published: the extract stops at MAXZOOM.
#
# Run by an operator, not CI. Needs the `pmtiles` CLI (github.com/protomaps/go-pmtiles)
# and a checkout of github.com/protomaps/basemaps-assets for the glyphs.
#
# Usage: publish-basemap.sh <source .pmtiles URL or file> <basemaps-assets dir> <bucket> <cloudfront distribution id>
#   source: a Protomaps daily build, e.g. https://build.protomaps.com/20261101.pmtiles
#   MAXZOOM (default 10, city level), BBOX (optional, minLon,minLat,maxLon,maxLat)
set -euo pipefail
SOURCE=${1:?source pmtiles}
ASSETS=${2:?basemaps-assets dir}
BUCKET=${3:?bucket}
DISTRIBUTION=${4:?distribution id}
MAXZOOM=${MAXZOOM:-10}
BBOX=${BBOX:-}

if [ "$MAXZOOM" -gt 10 ]; then
  echo "MAXZOOM $MAXZOOM is finer than city level (ADR-0038 caps it at 10)" >&2
  exit 1
fi
for font in 'Noto Sans Regular' 'Noto Sans Medium'; do
  [ -f "$ASSETS/fonts/$font/0-255.pbf" ] || { echo "missing glyphs: $ASSETS/fonts/$font" >&2; exit 1; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
args=(--maxzoom="$MAXZOOM")
[ -n "$BBOX" ] && args+=(--bbox="$BBOX")

# Size first: the extract is uploaded to S3 and served by CloudFront (storage + transfer cost).
pmtiles extract "$SOURCE" "$work/basemap.pmtiles" "${args[@]}" --dry-run
read -r -p "Extract and upload? [y/N] " answer
[ "$answer" = y ] || exit 1
pmtiles extract "$SOURCE" "$work/basemap.pmtiles" "${args[@]}"
pmtiles verify "$work/basemap.pmtiles"
printf 'source=%s\nmaxzoom=%s\nbbox=%s\npublished=%s\n' "$SOURCE" "$MAXZOOM" "${BBOX:-world}" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$work/SOURCE.txt"

# Glyphs first, then the tiles, so a client never sees tiles without labels.
for font in 'Noto Sans Regular' 'Noto Sans Medium'; do
  aws s3 sync "$ASSETS/fonts/$font" "s3://$BUCKET/map/v1/fonts/$font" \
    --content-type 'application/x-protobuf' --cache-control 'public, max-age=604800'
done
# Same name on each refresh (quarterly): a day of caching, then the invalidation below.
aws s3 cp "$work/basemap.pmtiles" "s3://$BUCKET/map/v1/basemap.pmtiles" \
  --content-type 'application/vnd.pmtiles' --cache-control 'public, max-age=86400'
aws s3 cp "$work/SOURCE.txt" "s3://$BUCKET/map/v1/SOURCE.txt" --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/map/*' >/dev/null
echo "published map base to s3://$BUCKET/map/v1 (maxzoom $MAXZOOM, ${BBOX:-world})"
