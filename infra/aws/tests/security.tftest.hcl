# Security invariants of the AWS stack (ADR-0004, 0007, 0012), checked without an
# AWS account: providers are mocked, so this runs in CI on every change.
#   tofu init -backend=false && tofu test

mock_provider "aws" {
  # Mocked values must still look like what the configuration and the provider's
  # own validation expect (ARNs, JSON policies).
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_resource "aws_lb" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-northeast-2:111122223333:loadbalancer/app/mock/1"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-northeast-2:111122223333:targetgroup/mock/1"
    }
  }
  mock_resource "aws_lb_listener" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-northeast-2:111122223333:listener/app/mock/1/1"
    }
  }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:ap-northeast-2:111122223333:certificate/mock"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111122223333:role/mock"
    }
  }
  mock_resource "aws_kms_key" {
    defaults = {
      arn = "arn:aws:kms:ap-northeast-2:111122223333:key/mock"
    }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::mock-bucket"
    }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:ap-northeast-2:111122223333:secret:mock"
    }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:ap-northeast-2:111122223333:cluster/mock"
      id  = "arn:aws:ecs:ap-northeast-2:111122223333:cluster/mock"
    }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn = "arn:aws:ecs:ap-northeast-2:111122223333:task-definition/mock:1"
    }
  }
  mock_resource "aws_ecs_service" {
    defaults = {
      id = "arn:aws:ecs:ap-northeast-2:111122223333:service/mock/mock"
    }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = {
      arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn = "arn:aws:cloudfront::111122223333:distribution/MOCK"
    }
  }
  mock_resource "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:ap-northeast-2:111122223333:repository/mock"
      repository_url = "111122223333.dkr.ecr.ap-northeast-2.amazonaws.com/mock"
    }
  }
  override_resource {
    target = aws_subnet.public
    values = { id = "subnet-public" }
  }
  override_resource {
    target = aws_subnet.private
    values = { id = "subnet-private" }
  }
  override_resource {
    target = aws_subnet.isolated
    values = { id = "subnet-isolated" }
  }
  override_resource {
    target = aws_security_group.alb
    values = { id = "sg-alb" }
  }
  override_resource {
    target = aws_security_group.api
    values = { id = "sg-api" }
  }
  override_resource {
    target = aws_security_group.media
    values = { id = "sg-media" }
  }
  override_resource {
    target = aws_security_group.worker
    values = { id = "sg-worker" }
  }
  override_resource {
    target = aws_security_group.db
    values = { id = "sg-db" }
  }
  override_resource {
    target = aws_security_group.endpoints
    values = { id = "sg-endpoints" }
  }
  mock_resource "aws_prometheus_workspace" {
    defaults = {
      arn                 = "arn:aws:aps:ap-northeast-2:111122223333:workspace/ws-mock"
      prometheus_endpoint = "https://aps-workspaces.ap-northeast-2.amazonaws.com/workspaces/ws-mock/"
    }
  }
  mock_resource "aws_cognito_user_pool" {
    defaults = { endpoint = "cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_mock" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-northeast-2:111122223333:mock-alerts" }
  }
  override_resource {
    target = aws_db_instance.main
    values = {
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:ap-northeast-2:111122223333:secret:rds-db-mock", secret_status = "active", kms_key_id = "mock" }]
      address            = "db.mock.internal"
      port               = 5432
    }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
  mock_resource "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:111122223333:certificate/mock" }
  }
}

mock_provider "random" {}

variables {
  environment         = "staging"
  domain              = "rabit.example"
  hosted_zone_id      = "Z0000000000000000000"
  bucket_prefix       = "rabit-stg-test"
  budget_alert_emails = ["ops@example.com"]
  alert_emails        = ["oncall@example.com"]
}

run "worker_is_isolated" {
  command = apply

  assert {
    condition     = length(aws_route_table.isolated.route) == 0
    error_message = "Isolated subnets must have no route to the internet (ADR-0007)."
  }
  assert {
    condition     = toset(aws_ecs_service.role["worker"].network_configuration[0].subnets) == toset(aws_subnet.isolated[*].id)
    error_message = "The worker must run in the isolated subnets."
  }
  assert {
    condition     = alltrue([for s in aws_ecs_service.role : s.network_configuration[0].assign_public_ip == false])
    error_message = "No task gets a public IP."
  }
  assert {
    condition = alltrue([
      for r in aws_vpc_security_group_egress_rule.api_media_https : r.security_group_id != aws_security_group.worker.id
    ])
    error_message = "The worker must not get the open HTTPS egress rule of api and media."
  }
  assert {
    condition     = length([for k, v in aws_ecs_service.role : k if length(v.load_balancer) > 0 && k == "worker"]) == 0
    error_message = "The worker is not reachable through the load balancer."
  }
}

run "containers_are_locked_down" {
  command = apply

  assert {
    condition = alltrue([
      for td in aws_ecs_task_definition.role : alltrue([
        for c in jsondecode(td.container_definitions) :
        c.readonlyRootFilesystem == true && c.user == "10001" && contains(c.linuxParameters.capabilities.drop, "ALL")
      ])
    ])
    error_message = "Every container runs read-only, as user 10001, with all capabilities dropped."
  }
  assert {
    condition = alltrue([
      for td in aws_ecs_task_definition.role : alltrue([
        for c in jsondecode(td.container_definitions) :
        c.name == "metrics" || contains([for e in c.environment : "${e.name}=${e.value}"], "AUTH_DEV_ISSUER_ENABLED=false") &&
        contains([for e in c.environment : "${e.name}=${e.value}"], "S3_SSE=aws:kms") &&
        contains([for e in c.environment : "${e.name}=${e.value}"], "NODE_ENV=production")
      ])
    ])
    error_message = "Production settings: no dev issuer, KMS encryption, NODE_ENV=production."
  }
  assert {
    condition = alltrue([
      for td in aws_ecs_task_definition.role : alltrue([
        for c in jsondecode(td.container_definitions) :
        length([for e in c.environment : e.name if contains(["MEDIA_TOKEN_SECRET", "CURSOR_SECRET", "DATABASE_PASSWORD", "S3_SECRET_ACCESS_KEY"], e.name)]) == 0
      ])
    ])
    error_message = "Secrets come from Secrets Manager, never plain environment values (R14)."
  }
}

run "storage_is_private_and_encrypted" {
  command = apply

  assert {
    condition     = length(aws_s3_bucket.ns) == 6
    error_message = "The six namespaces of ADR-0004 exist as buckets."
  }
  assert {
    condition = alltrue([
      for b in concat(values(aws_s3_bucket_public_access_block.ns), [aws_s3_bucket_public_access_block.web]) :
      b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets
    ])
    error_message = "Every bucket blocks public access."
  }
  assert {
    condition = alltrue([
      for c in aws_s3_bucket_server_side_encryption_configuration.ns : alltrue([
        for r in c.rule : alltrue([
          for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "aws:kms" && d.kms_master_key_id == aws_kms_key.data.arn
        ])
      ])
    ])
    error_message = "Buckets default to SSE-KMS with the environment key."
  }
  assert {
    condition     = aws_kms_key.data.enable_key_rotation
    error_message = "The data key rotates."
  }
  assert {
    condition = alltrue([
      for r in aws_s3_bucket_cors_configuration.quarantine.cors_rule :
      toset(r.allowed_origins) == toset(["https://app.rabit.example"]) && toset(r.allowed_methods) == toset(["PUT"])
    ])
    error_message = "Only the web client may upload to quarantine from a browser."
  }
}

run "database_is_private_and_recoverable" {
  command = apply

  assert {
    condition     = aws_db_instance.main.publicly_accessible == false && aws_db_instance.main.storage_encrypted
    error_message = "The database is private and encrypted."
  }
  assert {
    condition     = aws_db_instance.main.deletion_protection && aws_db_instance.main.backup_retention_period >= 7
    error_message = "Deletion protection and at least 7 days of point-in-time recovery (NFR-REL-008)."
  }
  assert {
    condition     = toset(aws_db_subnet_group.main.subnet_ids) == toset(aws_subnet.isolated[*].id)
    error_message = "The database lives in the isolated subnets."
  }
  assert {
    condition     = strcontains(local.database_url, "sslmode=verify-full")
    error_message = "Connections verify the RDS certificate."
  }
}

run "edge_uses_tls" {
  command = apply

  assert {
    condition     = startswith(aws_lb_listener.https.ssl_policy, "ELBSecurityPolicy-TLS13")
    error_message = "The load balancer uses a TLS 1.3 policy."
  }
  assert {
    condition     = aws_cloudfront_distribution.media.default_cache_behavior[0].viewer_protocol_policy == "https-only"
    error_message = "Media is served over HTTPS only."
  }
  assert {
    condition = alltrue([
      strcontains(local.content_security_policy, "script-src 'self'"),
      strcontains(local.content_security_policy, "frame-ancestors 'none'"),
      strcontains(local.content_security_policy, "https://api.rabit.example"),
      strcontains(local.content_security_policy, "https://rabit-stg-test-quarantine.s3.ap-northeast-2.amazonaws.com"),
      strcontains(local.content_security_policy, "https://cognito-idp.ap-northeast-2.amazonaws.com"),
      strcontains(local.content_security_policy, "https://rabit-stg-test-login.auth.ap-northeast-2.amazoncognito.com"),
      strcontains(local.content_security_policy, "https://rabit-stg-test-ops-login.auth.ap-northeast-2.amazoncognito.com"),
      !strcontains(local.content_security_policy, "unsafe-inline"),
      !strcontains(local.content_security_policy, "{"),
    ])
    error_message = "The web client gets the CSP from infra/web/csp.json with this environment's origins."
  }
  assert {
    condition     = length(aws_lb_listener_rule.media.condition) == 2
    error_message = "The media origin requires its host and the CloudFront secret header."
  }
}

run "alerts_are_deployed" {
  command = apply

  assert {
    condition     = aws_prometheus_rule_group_namespace.alerts.data == file("${path.module}/../observability/alerts.yml")
    error_message = "Managed Prometheus loads the same alert rules CI checks with promtool (R8)."
  }
  assert {
    condition = alltrue([
      for role in ["api", "media", "worker"] :
      length([for c in jsondecode(aws_ecs_task_definition.role[role].container_definitions) : c if c.name == "metrics"]) == 1
    ])
    error_message = "Every long-running role ships its metrics to Managed Prometheus."
  }
  assert {
    condition = alltrue([
      for role in ["api", "media", "worker"] :
      jsondecode(aws_ecs_task_definition.role[role].container_definitions)[0].name == role
    ])
    error_message = "The app container comes first (the deploy script swaps its image by name)."
  }
  assert {
    condition     = contains(keys(aws_vpc_endpoint.interface), "aps-workspaces")
    error_message = "The isolated worker reaches Managed Prometheus through an endpoint, not the internet."
  }
  assert {
    condition     = strcontains(aws_prometheus_alert_manager_definition.main.definition, aws_sns_topic.alerts.arn)
    error_message = "Alertmanager sends to the alerts topic."
  }
}

run "sign_in_is_cognito_with_an_mfa_operator_pool" {
  command = apply

  assert {
    condition     = aws_cognito_user_pool.operators.mfa_configuration == "ON"
    error_message = "Every operator sign-in needs MFA (NFR-SEC-007, ADR-0009)."
  }
  assert {
    condition     = aws_cognito_user_pool.operators.admin_create_user_config[0].allow_admin_create_user_only
    error_message = "Nobody can sign up as an operator."
  }
  assert {
    condition     = contains(aws_cognito_user_pool.users.auto_verified_attributes, "email")
    error_message = "Users verify their email before they can sign in (ACC-002)."
  }
  assert {
    condition = alltrue([
      for c in aws_cognito_user_pool_client.web :
      c.generate_secret == false && toset(c.allowed_oauth_flows) == toset(["code"]) && toset(c.callback_urls) == toset(["https://app.rabit.example/"])
    ])
    error_message = "Browser clients use the code flow without a secret and return only to the app."
  }
  assert {
    condition = alltrue([
      for td in aws_ecs_task_definition.role : alltrue([
        for c in jsondecode(td.container_definitions) :
        c.name == "metrics" || (
          contains([for e in c.environment : "${e.name}=${e.value}"], "AUTH_PROFILE=cognito") &&
          length([for e in c.environment : e if e.name == "AUTH_OPERATOR_ISSUER"]) == 1
        )
      ])
    ])
    error_message = "The api trusts the user pool in Cognito mode and the operator pool for operators."
  }
}

run "rejects_unknown_environment" {
  command = plan
  variables {
    environment = "prod"
  }
  expect_failures = [var.environment]
}
