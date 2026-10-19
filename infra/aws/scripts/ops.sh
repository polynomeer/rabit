#!/usr/bin/env bash
# Runs the ops task (migrations, restore reconcile, …) with the image the api is
# running now, not whatever revision OpenTofu registered last (it registers task
# definitions with the bootstrap image; deploys register the real ones).
#
# Usage: ops.sh <command...>     e.g. ops.sh restore-reconcile --dry-run
# Required env: AWS_REGION, ENVIRONMENT, OPS_SUBNETS (comma-separated), OPS_SECURITY_GROUP
set -euo pipefail
: "${AWS_REGION:?}" "${ENVIRONMENT:?}" "${OPS_SUBNETS:?}" "${OPS_SECURITY_GROUP:?}"
[ $# -gt 0 ] || { echo "usage: ops.sh <command...>" >&2; exit 2; }
NAME="rabit-${ENVIRONMENT}"
CLUSTER="$NAME"

API_TD=$(aws ecs describe-services --cluster "$CLUSTER" --services api \
  --query 'services[0].taskDefinition' --output text)
IMAGE=$(aws ecs describe-task-definition --task-definition "$API_TD" \
  --query "taskDefinition.containerDefinitions[?name=='api'].image | [0]" --output text)
echo "running ops with $IMAGE: $*"

aws ecs describe-task-definition --task-definition "$NAME-ops" --query taskDefinition --output json |
  jq --arg image "$IMAGE" '
    (.containerDefinitions[] | select(.name == "ops")).image = $image
    | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
          .registeredAt, .registeredBy, .deregisteredAt)' >/tmp/td-ops-run.json
TD=$(aws ecs register-task-definition --cli-input-json file:///tmp/td-ops-run.json \
  --query taskDefinition.taskDefinitionArn --output text)

COMMAND=$(jq -cn '$ARGS.positional' --args "$@")
TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$TD" \
  --network-configuration "awsvpcConfiguration={subnets=[${OPS_SUBNETS}],securityGroups=[${OPS_SECURITY_GROUP}],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"ops\",\"command\":$COMMAND}]}" \
  --query 'tasks[0].taskArn' --output text)
echo "started $TASK; logs: /rabit/${ENVIRONMENT}/ops"
