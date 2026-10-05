resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "role" {
  for_each          = toset(["api", "media", "worker", "ops"])
  name              = "/rabit/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
}

locals {
  image = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"

  # sslmode=verify-full against the RDS CA bundle baked into the image.
  database_url = "postgres://${aws_db_instance.main.username}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem"

  environment = [
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
    { name = "AUTH_ISSUER", value = var.auth_issuer },
    { name = "AUTH_AUDIENCE", value = var.auth_audience },
    { name = "AUTH_JWKS_URL", value = var.auth_jwks_url },
    { name = "AUTH_DEV_ISSUER_ENABLED", value = "false" },
    { name = "RATE_LIMIT_STORE", value = "postgres" },
    { name = "WORKER_CONCURRENCY", value = tostring(var.worker_concurrency) },
  ]

  secrets = [
    { name = "DATABASE_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
    { name = "MEDIA_TOKEN_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:MEDIA_TOKEN_SECRET::" },
    { name = "CURSOR_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:CURSOR_SECRET::" },
  ]

  # Long-running roles. `ops` (migrations, restore reconcile, catalog ingest) is a
  # one-off task definition run by CI or on-call with a command override.
  roles = {
    api    = { port = local.ports.api, subnets = aws_subnet.private[*].id, sg = aws_security_group.api.id, size = var.task_sizes.api, count = var.api_desired_count, task_role = "api" }
    media  = { port = local.ports.media, subnets = aws_subnet.private[*].id, sg = aws_security_group.media.id, size = var.task_sizes.media, count = var.media_desired_count, task_role = "media" }
    worker = { port = null, subnets = aws_subnet.isolated[*].id, sg = aws_security_group.worker.id, size = var.task_sizes.worker, count = var.worker_desired_count, task_role = "worker" }
  }
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
    command                = each.key == "ops" ? ["migrate", "up"] : [each.key]
    readonlyRootFilesystem = true
    user                   = "10001"
    linuxParameters        = { capabilities = { drop = ["ALL"] }, initProcessEnabled = false }
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
    portMappings           = each.value.port == null ? [] : [{ containerPort = each.value.port, protocol = "tcp" }]
    environment            = local.environment
    secrets                = local.secrets
    stopTimeout            = 60
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
  for_each        = local.roles
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
