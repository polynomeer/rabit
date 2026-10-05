# Alerts on AWS (R8): each long-running task runs an ADOT collector next to the app
# that scrapes the app's internal metrics port and remote-writes to Amazon Managed
# Service for Prometheus. The rules are infra/observability/alerts.yml as-is (the
# same file CI checks with promtool); Alertmanager sends to an SNS topic by email.

resource "aws_prometheus_workspace" "main" {
  alias = local.name
}

resource "aws_prometheus_rule_group_namespace" "alerts" {
  name         = "rabit-alerts"
  workspace_id = aws_prometheus_workspace.main.id
  data         = file("${path.module}/../observability/alerts.yml")
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

data "aws_iam_policy_document" "alerts_topic" {
  statement {
    actions   = ["sns:Publish", "sns:GetTopicAttributes"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["aps.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_prometheus_workspace.main.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

resource "aws_sns_topic_subscription" "alerts_email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_prometheus_alert_manager_definition" "main" {
  workspace_id = aws_prometheus_workspace.main.id
  definition   = <<-YAML
    alertmanager_config: |
      route:
        receiver: email
        group_by: [alertname, environment]
        group_wait: 30s
        group_interval: 5m
        repeat_interval: 4h
      receivers:
        - name: email
          sns_configs:
            - topic_arn: ${aws_sns_topic.alerts.arn}
              sigv4:
                region: ${var.region}
              subject: '[${var.environment}] {{ .CommonLabels.alertname }} ({{ .CommonLabels.severity }})'
  YAML
}

# ADOT comes from public.ecr.aws through a pull-through cache, so the isolated
# worker pulls it from our own registry over the ECR endpoints.
resource "aws_ecr_pull_through_cache_rule" "ecr_public" {
  ecr_repository_prefix = "ecr-public"
  upstream_registry_url = "public.ecr.aws"
}

locals {
  # Each role's internal metrics port (apps/server/src/entry/*.ts).
  metrics_port = { api = local.ports.metrics, worker = local.ports.metrics + 1, media = local.ports.metrics + 2 }

  collector_image = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com/${aws_ecr_pull_through_cache_rule.ecr_public.ecr_repository_prefix}/aws-observability/aws-otel-collector:${var.collector_image_tag}"

  collector = {
    for role, port in local.metrics_port : role => {
      name                   = "metrics"
      image                  = local.collector_image
      essential              = false
      readonlyRootFilesystem = true
      user                   = "10001"
      linuxParameters        = { capabilities = { drop = ["ALL"] }, initProcessEnabled = false }
      memoryReservation      = 64
      environment = [{
        name = "AOT_CONFIG_CONTENT"
        value = yamlencode({
          extensions = { sigv4auth = { region = var.region, service = "aps" } }
          receivers = {
            prometheus = {
              config = {
                scrape_configs = [{
                  job_name        = "rabit"
                  scrape_interval = "30s"
                  static_configs = [{
                    targets = ["localhost:${port}"]
                    labels  = { environment = var.environment, role = role }
                  }]
                }]
              }
            }
          }
          processors = { batch = {} }
          exporters = {
            prometheusremotewrite = {
              endpoint = "${aws_prometheus_workspace.main.prometheus_endpoint}api/v1/remote_write"
              auth     = { authenticator = "sigv4auth" }
            }
          }
          service = {
            extensions = ["sigv4auth"]
            pipelines  = { metrics = { receivers = ["prometheus"], processors = ["batch"], exporters = ["prometheusremotewrite"] } }
          }
        })
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.role[role].name
          awslogs-region        = var.region
          awslogs-stream-prefix = "metrics"
        }
      }
    }
  }
}

data "aws_iam_policy_document" "remote_write" {
  statement {
    actions   = ["aps:RemoteWrite"]
    resources = [aws_prometheus_workspace.main.arn]
  }
}

resource "aws_iam_role_policy" "remote_write" {
  for_each = local.metrics_port
  name     = "prometheus-remote-write"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.remote_write.json
}

# The first pull of a cached image creates its repository in our registry.
data "aws_iam_policy_document" "pull_through" {
  statement {
    actions   = ["ecr:BatchImportUpstreamImage", "ecr:CreateRepository"]
    resources = ["arn:${data.aws_partition.current.partition}:ecr:${var.region}:${data.aws_caller_identity.current.account_id}:repository/ecr-public/*"]
  }
}

resource "aws_iam_role_policy" "pull_through" {
  name   = "ecr-pull-through"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.pull_through.json
}
