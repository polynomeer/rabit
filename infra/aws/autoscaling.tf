# The transcoder follows the media backlog (ADR-0005 amendment 2026-10-20). The
# general worker writes `MediaJobsReady` every 30 s as an Embedded Metric Format log
# line; CloudWatch Logs turns it into a metric in this namespace.
locals {
  backlog_namespace = "Rabit/${var.environment}"
}

resource "aws_appautoscaling_target" "transcoder" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.transcoder.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.transcoder_min_count
  max_capacity       = var.transcoder_max_count
}

# More tasks the deeper the backlog; the steps are relative to the alarm threshold.
resource "aws_appautoscaling_policy" "transcoder_out" {
  name               = "${local.name}-transcoder-out"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.transcoder.service_namespace
  resource_id        = aws_appautoscaling_target.transcoder.resource_id
  scalable_dimension = aws_appautoscaling_target.transcoder.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 120
    metric_aggregation_type = "Maximum"
    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 20
      scaling_adjustment          = 1
    }
    step_adjustment {
      metric_interval_lower_bound = 20
      metric_interval_upper_bound = 100
      scaling_adjustment          = 2
    }
    step_adjustment {
      metric_interval_lower_bound = 100
      scaling_adjustment          = 4
    }
  }
}

# One task at a time once nothing has waited for 15 minutes. A task stopped while a
# job runs hands the job back after the 90 s grace; another task runs it again.
resource "aws_appautoscaling_policy" "transcoder_in" {
  name               = "${local.name}-transcoder-in"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.transcoder.service_namespace
  resource_id        = aws_appautoscaling_target.transcoder.resource_id
  scalable_dimension = aws_appautoscaling_target.transcoder.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300
    metric_aggregation_type = "Maximum"
    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "media_backlog_high" {
  alarm_name          = "${local.name}-media-backlog-high"
  alarm_description   = "Media jobs are waiting: add transcoder tasks."
  namespace           = local.backlog_namespace
  metric_name         = "MediaJobsReady"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 4
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.transcoder_out.arn]
}

resource "aws_cloudwatch_metric_alarm" "media_backlog_empty" {
  alarm_name          = "${local.name}-media-backlog-empty"
  alarm_description   = "No media job has waited for 15 minutes: remove a transcoder task."
  namespace           = local.backlog_namespace
  metric_name         = "MediaJobsReady"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 15
  comparison_operator = "LessThanOrEqualToThreshold"
  threshold           = 0
  # Without data (worker down) the count stays as it is.
  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_appautoscaling_policy.transcoder_in.arn]
}
