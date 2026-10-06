#!/usr/bin/env bash
# Post-deploy checks against the public addresses (ADR-0012). Run by the deploy
# workflow after the rollout; also by the E2E suite against its production-like
# instances, so the script itself is tested on every CI run.
#
# Required: API_URL, APP_URL. Optional: MEDIA_URL (through CloudFront),
# MEDIA_ORIGIN_URL (the load balancer host CloudFront uses), EXPECT_HSTS=true|false.
# Exits non-zero if any check fails; prints one line per check.
set -u
: "${API_URL:?}" "${APP_URL:?}"
FAILED=0

# expect <name> <detail> <command...>: passes when the command succeeds.
expect() {
  local name=$1 detail=$2
  shift 2
  if "$@"; then echo "PASS  $name $detail"; else echo "FAIL  $name $detail"; FAILED=1; fi
}
# shellcheck disable=SC2317,SC2329 # called through expect
contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
header() { # header <url> <name>: the header's value, lowercase name match
  curl -s -D - -o /dev/null --max-time 15 "$1" | tr -d '\r' |
    awk -v h="$(echo "$2" | tr '[:upper:]' '[:lower:]')" -F': ' 'tolower($1) == h { $1 = ""; sub(/^ /, ""); print; exit }'
}

ready=$(curl -s --max-time 15 "$API_URL/readyz")
expect "api ready (database and storage)" "$ready" \
  grep -q '"database":"ok".*"storage":"ok"' <<<"$ready"

c=$(code "$API_URL/v1/me")
expect "api requires a token" "($c)" test "$c" = 401

# T03: the development issuer must not exist outside development.
c=$(code -X POST -H 'content-type: application/json' -d '{"subject":"smoke"}' "$API_URL/dev/token")
expect "no development token issuer" "($c)" test "$c" = 404

c=$(code "$APP_URL/")
expect "web client served" "($c)" test "$c" = 200
csp=$(header "$APP_URL/" content-security-policy)
expect "CSP allows scripts only from the app" "" contains "$csp" "script-src 'self'"
expect "CSP forbids framing" "" contains "$csp" "frame-ancestors 'none'"
expect "CSP has no unsafe-inline" "" test -n "$csp" -a "${csp/unsafe-inline/}" = "$csp"

if [ "${EXPECT_HSTS:-true}" = true ]; then
  expect "web client sends HSTS" "" test -n "$(header "$APP_URL/" strict-transport-security)"
  expect "web client refuses framing" "" test "$(header "$APP_URL/" x-frame-options)" = DENY
fi

if [ -n "${MEDIA_URL:-}" ]; then
  # Through CloudFront the gateway answers (a forged token is refused by the gateway).
  c=$(code "$MEDIA_URL/media/v1/forged-token/index.m3u8")
  expect "media gateway reachable through CloudFront, refuses a forged token" "($c)" test "$c" = 403
fi
if [ -n "${MEDIA_ORIGIN_URL:-}" ]; then
  # Without CloudFront's secret header the load balancer does not forward to media.
  c=$(code "$MEDIA_ORIGIN_URL/media/v1/forged-token/index.m3u8")
  expect "media origin refuses requests that bypass CloudFront" "($c)" test "$c" = 404
fi

exit "$FAILED"
