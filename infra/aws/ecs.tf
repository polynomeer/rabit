resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "role" {
  for_each          = toset(["api", "media", "worker", "transcoder", "ops"])
  name              = "/rabit/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
}

locals {
  image = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"

  # sslmode=verify-full against the RDS CA bundle baked into the image.
  database_url = "postgres://${aws_db_instance.main.username}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem"

  environment = concat([
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "API_PORT", value = tostring(local.ports.api) },
    { name = "MEDIA_PORT", value = tostring(local.ports.media) },
    { name = "METRICS_PORT", value = tostring(local.ports.metrics) },
    { name = "API_PUBLIC_BASE_URL", value = "https://${local.hosts.api}" },
    { name = "MEDIA_PUBLIC_BASE_URL", value = "https://${local.hosts.media}" },
    { name = "CORS_ALLOWED_ORIGINS", value = "https://${local.hosts.app}" },
    { name = "DATABASE_URL", value = local.database_url },
    { name = "S3_REGION", value = var.region },
    { name = "S3_BUCKET_PREFIX", value = var.bucket_prefix },
    { name = "S3_SSE", value = "aws:kms" },
    { name = "S3_SSE_KMS_KEY_ID", value = aws_kms_key.data.arn },
    { name = "AUTH_PROFILE", value = "cognito" },
    { name = "AUTH_ISSUER", value = local.cognito_issuer.users },
    { name = "AUTH_JWKS_URL", value = "${local.cognito_issuer.users}/.well-known/jwks.json" },
    { name = "AUTH_AUDIENCE", value = join(",", local.user_client_ids) },
    { name = "AUTH_OPERATOR_ISSUER", value = local.cognito_issuer.operators },
    { name = "AUTH_OPERATOR_JWKS_URL", value = "${local.cognito_issuer.operators}/.well-known/jwks.json" },
    { name = "AUTH_OPERATOR_AUDIENCE", value = aws_cognito_user_pool_client.web["operators"].id },
    { name = "AUTH_DEV_ISSUER_ENABLED", value = "false" },
    { name = "RATE_LIMIT_STORE", value = "postgres" },
    ], var.app_store_environment == "off" ? [] : [
    # App Store in-app purchase (ADR-0024); Apple's root certificate is baked into the image.
    { name = "APP_STORE_ENVIRONMENT", value = var.app_store_environment },
    { name = "APP_STORE_ROOT_CERTS", value = "/etc/ssl/apple/AppleRootCA-G3.cer" },
    ], var.app_store_app_apple_id == null ? [] : [
    { name = "APP_STORE_APP_APPLE_ID", value = tostring(var.app_store_app_apple_id) },
    ], var.app_store_environment == "Production" ? [
    # App Review and TestFlight buy in Sandbox: test purchases, access without a sale.
    { name = "APP_STORE_ACCEPT_SANDBOX", value = tostring(var.app_store_accept_review_sandbox) },
    ] : [
  ])

  secrets = [
    { name = "DATABASE_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
    { name = "MEDIA_TOKEN_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:MEDIA_TOKEN_SECRET::" },
    { name = "CURSOR_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:CURSOR_SECRET::" },
    { name = "MEDIA_EDGE_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:MEDIA_EDGE_SECRET::" },
  ]

  # Per-role settings on top of `environment`: the worker runs everything but media
  # processing, the transcoder only media processing (ADR-0005 amendment 2026-10-20).
  role_environment = {
    worker = [
      { name = "WORKER_POOL", value = "general" },
      { name = "WORKER_CONCURRENCY", value = tostring(var.worker_concurrency) },
      { name = "METRICS_CLOUDWATCH_NAMESPACE", value = local.backlog_namespace },
    ]
    transcoder = [
      { name = "WORKER_POOL", value = "media" },
      { name = "WORKER_CONCURRENCY", value = tostring(var.transcoder_concurrency) },
    ]
  }

  # Long-running roles. `ops` (migrations, restore reconcile, catalog ingest) is a
  # one-off task definition run by CI or on-call with a command override.
  roles = {
    api    = { port = local.ports.api, subnets = aws_subnet.private[*].id, sg = aws_security_group.api.id, size = var.task_sizes.api, count = var.api_desired_count, task_role = "api" }
    media  = { port = local.ports.media, subnets = aws_subnet.private[*].id, sg = aws_security_group.media.id, size = var.task_sizes.media, count = var.media_desired_count, task_role = "media" }
    worker = { port = null, subnets = aws_subnet.isolated[*].id, sg = aws_security_group.worker.id, size = var.task_sizes.worker, count = var.worker_desired_count, task_role = "worker" }
    # Same isolation and IAM role as the worker; its task count follows the media backlog.
    transcoder = { port = null, subnets = aws_subnet.isolated[*].id, sg = aws_security_group.worker.id, size = var.task_sizes.transcoder, count = var.transcoder_min_count, task_role = "worker" }
  }
  services = { for k, v in local.roles : k => v if k != "transcoder" }
}

resource "aws_ecs_task_definition" "role" {
  for_each                 = merge(local.roles, { ops = merge(local.roles.worker, { task_role = "worker" }) })
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.size.cpu
  memory                   = each.value.size.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.value.task_role].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  # Read-only root file system; scratch space only under /tmp (ADR-0007).
  volume {
    name = "tmp"
  }

  # The app container first; long-running roles add the metrics collector (R8).
  container_definitions = jsonencode(concat([{
    name                   = each.key
    image                  = local.image
    essential              = true
    command                = each.key == "ops" ? ["migrate", "up"] : each.key == "transcoder" ? ["worker"] : [each.key]
    readonlyRootFilesystem = true
    user                   = "10001"
    linuxParameters        = { capabilities = { drop = ["ALL"] }, initProcessEnabled = false }
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
    portMappings           = each.value.port == null ? [] : [{ containerPort = each.value.port, protocol = "tcp" }]
    environment            = concat(local.environment, lookup(local.role_environment, each.key, []))
    secrets                = local.secrets
    # The worker hands unfinished jobs back after a 90 s grace (SHUTDOWN_GRACE_MS);
    # 120 s is Fargate's maximum.
    stopTimeout = contains(["worker", "transcoder"], each.key) ? 120 : 60
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.role[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = each.key
      }
    }
  }], each.key == "ops" ? [] : [local.collector[each.key]]))
}

resource "aws_ecs_service" "role" {
  for_each        = local.services
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.role[each.key].arn
  desired_count   = each.value.count
  launch_type     = "FARGATE"

  # A worker restart re-queues its leased jobs; give in-flight requests time to finish.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = each.value.subnets
    security_groups  = [each.value.sg]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = each.value.port == null ? [] : [1]
    content {
      target_group_arn = aws_lb_target_group.role[each.key].arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  # CI registers new task definition revisions on deploy (deploy workflow).
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.https]
}

# The transcoder's task count belongs to Application Auto Scaling (autoscaling.tf),
# so OpenTofu sets it only on creation.
resource "aws_ecs_service" "transcoder" {
  name            = "transcoder"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.role["transcoder"].arn
  desired_count   = var.transcoder_min_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.roles.transcoder.subnets
    security_groups  = [local.roles.transcoder.sg]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
