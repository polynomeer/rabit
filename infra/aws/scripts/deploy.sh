#!/usr/bin/env bash
# Deploys one image to an environment (ADR-0012). Called by .github/workflows/deploy.yml
# with AWS credentials from GitHub OIDC; can also be run by on-call with the same role.
#
# Order: register task definitions → run migrations (expand-only, erd §5) → roll
# out api, media, worker → wait until stable. A failed migration stops the deploy
# before any service changes; a failed rollout is rolled back by the ECS circuit breaker.
#
# Required env: AWS_REGION, ENVIRONMENT, IMAGE (full ECR URI with tag),
#               OPS_SUBNETS (comma-separated), OPS_SECURITY_GROUP
set -euo pipefail
: "${AWS_REGION:?}" "${ENVIRONMENT:?}" "${IMAGE:?}" "${OPS_SUBNETS:?}" "${OPS_SECURITY_GROUP:?}"
NAME="rabit-${ENVIRONMENT}"
CLUSTER="$NAME"

# New revision of a task definition family with only the image changed.
register() {
  aws ecs describe-task-definition --task-definition "$NAME-$1" --query taskDefinition --output json |
    jq --arg image "$IMAGE" --arg role "$1" '
      (.containerDefinitions[] | select(.name == $role)).image = $image
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' >"/tmp/td-$1.json"
  aws ecs register-task-definition --cli-input-json "file:///tmp/td-$1.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

declare -A TD
for role in ops api media worker; do
  TD[$role]=$(register "$role")
  echo "registered ${TD[$role]}"
done

echo "running migrations"
TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "${TD[ops]}" \
  --network-configuration "awsvpcConfiguration={subnets=[${OPS_SUBNETS}],securityGroups=[${OPS_SECURITY_GROUP}],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"ops","command":["migrate","up"]}]}' \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$CODE" != "0" ]; then
  echo "migration failed (exit $CODE); services unchanged. Logs: /rabit/${ENVIRONMENT}/ops" >&2
  exit 1
fi

for role in api media worker; do
  aws ecs update-service --cluster "$CLUSTER" --service "$role" \
    --task-definition "${TD[$role]}" --query service.serviceName --output text
done
aws ecs wait services-stable --cluster "$CLUSTER" --services api media worker
echo "deployed $IMAGE to $ENVIRONMENT"
