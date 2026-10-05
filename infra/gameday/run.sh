#!/usr/bin/env bash
# Local game day (R17, runbooks.md): breaks storage, the database and the worker
# on an isolated stack and checks that each fails as the runbook says and recovers
# without manual repair. Own containers and ports, so the dev stack is untouched.
#
#   pnpm build && sh infra/gameday/run.sh
#
# Prints one line per check and exits non-zero if any check fails.
set -u
cd "$(dirname "$0")/../.."
ROOT=$PWD
# Dev defaults first; everything below overrides ports, URLs and endpoints.
set -a
# shellcheck disable=SC1091
. "$ROOT/.env.example"
set +a
PG=rabit-gameday-pg S3=rabit-gameday-s3
PG_PORT=${GAMEDAY_PG_PORT:-55450} S3_PORT=${GAMEDAY_S3_PORT:-59100}
API_PORT=${GAMEDAY_API_PORT:-18180} MEDIA_PORT=${GAMEDAY_MEDIA_PORT:-18181} METRICS_PORT=${GAMEDAY_METRICS_PORT:-19464}
API=http://127.0.0.1:$API_PORT
LOGS=$(mktemp -d)
FAILED=0
PIDS=""

cleanup() {
  for p in $PIDS; do kill "$p" 2>/dev/null; done
  docker rm -f "$PG" "$S3" >/dev/null 2>&1
  echo "logs: $LOGS"
}
trap cleanup EXIT

check() { # check <name> <ok:0|1> [detail]
  if [ "$2" = 0 ]; then echo "PASS  $1 ${3:-}"; else echo "FAIL  $1 ${3:-}"; FAILED=1; fi
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# wait_for <seconds> <command...>: retries until the command succeeds; prints elapsed seconds.
wait_for() {
  local limit=$1 start=$SECONDS; shift
  until "$@" >/dev/null 2>&1; do
    [ $((SECONDS - start)) -ge "$limit" ] && { echo "timeout"; return 1; }
    sleep 1
  done
  echo "$((SECONDS - start))s"
}
ready_is() { [ "$(status "$API/readyz")" = "$1" ]; }

# ——— isolated stack ———
docker rm -f "$PG" "$S3" >/dev/null 2>&1
docker run -d --name "$PG" -p "127.0.0.1:$PG_PORT:5432" -e POSTGRES_USER=rabit -e POSTGRES_PASSWORD=rabit \
  -e POSTGRES_DB=rabit postgres:16-alpine >/dev/null
docker run -d --name "$S3" -p "127.0.0.1:$S3_PORT:8333" -e WEED_S3_SSE_KEY=rabit-dev-only-sse-key \
  -v "$ROOT/infra/seaweedfs:/init:ro" chrislusf/seaweedfs:4.47 server -dir=/data -s3 -s3.port=8333 \
  -s3.config=/init/s3.json -master.volumeSizeLimitMB=64 -volume.max=0 >/dev/null
wait_for 60 docker exec "$PG" pg_isready -U rabit -d rabit >/dev/null
wait_for 60 curl -sf "http://127.0.0.1:$S3_PORT/healthz" >/dev/null
sleep 2
docker exec "$S3" sh /init/create-buckets.sh localhost:9333 >/dev/null

export LOG_LEVEL=warn API_PORT MEDIA_PORT METRICS_PORT
export DATABASE_URL=postgres://rabit:rabit@127.0.0.1:$PG_PORT/rabit
export S3_ENDPOINT=http://127.0.0.1:$S3_PORT S3_PUBLIC_ENDPOINT=http://127.0.0.1:$S3_PORT
export API_PUBLIC_BASE_URL=$API MEDIA_PUBLIC_BASE_URL=http://127.0.0.1:$MEDIA_PORT AUTH_ISSUER=$API/dev
cd apps/server
node dist/entry/migrate.js up >"$LOGS/migrate.log" 2>&1 || { echo "migrate failed"; exit 1; }
start() { node "dist/entry/$1.js" >>"$LOGS/$1.log" 2>&1 & PIDS="$PIDS $!"; eval "PID_$1=$!"; }
start api
start worker
start media
wait_for 30 ready_is 200 >/dev/null
check "stack ready" $? "(readyz 200)"

token() {
  curl -sf -X POST "$API/dev/token" -H 'content-type: application/json' -d "{\"subject\":\"$1\"}" |
    node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).access_token))'
}
TOKEN=$(token "gameday-$$")
me() { status -H "authorization: Bearer $TOKEN" "$API/v1/me"; }
[ "$(me)" = 200 ]; check "baseline: GET /v1/me" $?

# ——— 1. object storage outage (runbook api-errors §3) ———
docker stop "$S3" >/dev/null
wait_for 30 ready_is 503 >/dev/null
check "storage down: readyz reports 503" $?
curl -s "$API/readyz" | grep -q storage; check "storage down: readyz names storage" $?
[ "$(status "$API/healthz")" = 200 ]; check "storage down: liveness stays 200 (no restart loop)" $?
[ "$(me)" = 200 ]; check "storage down: metadata reads still work" $?
docker start "$S3" >/dev/null
t=$(wait_for 90 ready_is 200); check "storage back: ready again without restarting the api" $? "($t)"

# ——— 2. database outage (runbook api-errors §2: fail closed) ———
docker stop "$PG" >/dev/null
wait_for 30 ready_is 503 >/dev/null
check "database down: readyz reports 503" $?
code=$(me); [ "${code#5}" != "$code" ]; check "database down: requests fail closed (5xx)" $? "($code)"
kill -0 "$PID_api" 2>/dev/null; check "database down: api process keeps running" $?
docker start "$PG" >/dev/null
t=$(wait_for 90 ready_is 200); check "database back: ready again without restarting the api" $? "($t)"
t=$(wait_for 30 sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer $TOKEN' $API/v1/me)\" = 200 ]")
check "database back: requests succeed" $? "($t)"

# ——— 3. worker down (runbook queue-backlog; alert QueueMetricsMissing) ———
WORKER_METRICS=http://127.0.0.1:$((METRICS_PORT + 1))/metrics
curl -sf "$WORKER_METRICS" | grep -q '^rabit_job_oldest_queued_seconds'
check "worker up: exports queue metrics" $?
kill "$PID_worker"; wait "$PID_worker" 2>/dev/null
! curl -sf "$WORKER_METRICS" >/dev/null 2>&1; check "worker down: queue metrics absent (QueueMetricsMissing fires)" $?
[ "$(status -X DELETE -H "authorization: Bearer $TOKEN" -H "idempotency-key: gameday-$$" "$API/v1/me")" = 202 ]
check "worker down: account deletion is accepted (queued)" $?
sleep 3
user_status() {
  docker exec "$PG" psql -U rabit -d rabit -tAc "SELECT status FROM app_user WHERE oidc_subject = 'gameday-$$' OR oidc_subject LIKE 'deleted:%' ORDER BY updated_at DESC LIMIT 1"
}
[ "$(user_status)" = deletion_requested ]; check "worker down: deletion waits in the queue" $? "($(user_status))"
start worker
t=$(wait_for 60 sh -c "[ \"\$(docker exec $PG psql -U rabit -d rabit -tAc \"SELECT count(*) FROM app_user WHERE status = 'deletion_requested'\")\" = 0 ]")
check "worker back: queued deletion completes" $? "($t)"

echo
[ "$FAILED" = 0 ] && echo "game day: all checks passed" || echo "game day: some checks FAILED"
exit "$FAILED"
