output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in the GitHub environment."
  value       = aws_iam_role.deploy.arn
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "ops_task" {
  description = "Run migrations or restore reconcile: aws ecs run-task with this family and a command override."
  value = {
    family          = aws_ecs_task_definition.role["ops"].family
    subnets         = aws_subnet.isolated[*].id
    security_groups = [aws_security_group.worker.id]
  }
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "urls" {
  value = { for k, h in local.hosts : k => "https://${h}" if k != "media_origin" }
}

output "kms_key_arn" {
  value = aws_kms_key.data.arn
}

output "prometheus_workspace_id" {
  value = aws_prometheus_workspace.main.id
}

output "alerts_topic_arn" {
  description = "Each address in alert_emails must confirm its subscription."
  value       = aws_sns_topic.alerts.arn
}

output "oidc" {
  description = "Set as OIDC_* in the GitHub environment (web client sign-in, ADR-0009)."
  value = {
    OIDC_ISSUER             = local.cognito_issuer.users
    OIDC_CLIENT_ID          = aws_cognito_user_pool_client.web["users"].id
    OIDC_OPERATOR_ISSUER    = local.cognito_issuer.operators
    OIDC_OPERATOR_CLIENT_ID = aws_cognito_user_pool_client.web["operators"].id
  }
}

output "operator_pool_id" {
  description = "Create operators here (owner-actions O-03)."
  value       = aws_cognito_user_pool.operators.id
}
