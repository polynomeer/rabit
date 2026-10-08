resource "aws_lb" "main" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 60

  lifecycle {
    precondition {
      condition     = var.environment == "staging" || local.use_domain
      error_message = "Production needs a domain: set domain and hosted_zone_id."
    }
    precondition {
      condition     = !local.use_domain || var.hosted_zone_id != ""
      error_message = "A domain needs its Route 53 hosted zone: set hosted_zone_id."
    }
  }
}

resource "aws_lb_target_group" "role" {
  for_each             = { api = local.ports.api, media = local.ports.media }
  name                 = "${local.name}-${each.key}"
  port                 = each.value
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  # Readiness, not liveness: an instance that lost the database or storage leaves
  # rotation; if every instance fails, the load balancer fails open.
  health_check {
    path                = "/readyz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# With a domain, port 80 only redirects to HTTPS. Without one it is CloudFront's
# origin: the security group admits only CloudFront, and the rules below forward
# only requests that carry the secret header.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = local.use_domain ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
  dynamic "default_action" {
    for_each = local.use_domain ? [] : [1]
    content {
      type = "fixed-response"
      fixed_response {
        content_type = "text/plain"
        message_body = "not found"
        status_code  = "404"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.use_domain ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.regional[0].certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

# Media is served only through CloudFront: the shared header that viewers cannot
# see or set, plus the origin host (with a domain) or the role header (without).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

locals {
  origin_listener_arn = local.use_domain ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  # role → header conditions; with a domain the api is public at api.<domain>.
  origin_headers = {
    api   = local.use_domain ? {} : { "x-origin-verify" = random_password.origin_verify.result, "x-origin-role" = "api" }
    media = local.use_domain ? { "x-origin-verify" = random_password.origin_verify.result } : { "x-origin-verify" = random_password.origin_verify.result, "x-origin-role" = "media" }
  }
  origin_hosts = {
    api   = local.use_domain ? [local.domain_hosts.api] : []
    media = local.use_domain ? [local.domain_hosts.media_origin] : []
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = local.origin_listener_arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.role["api"].arn
  }
  dynamic "condition" {
    for_each = local.origin_hosts.api
    content {
      host_header {
        values = [condition.value]
      }
    }
  }
  dynamic "condition" {
    for_each = local.origin_headers.api
    content {
      http_header {
        http_header_name = condition.key
        values           = [condition.value]
      }
    }
  }
}

resource "aws_lb_listener_rule" "media" {
  listener_arn = local.origin_listener_arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.role["media"].arn
  }
  dynamic "condition" {
    for_each = local.origin_hosts.media
    content {
      host_header {
        values = [condition.value]
      }
    }
  }
  dynamic "condition" {
    for_each = local.origin_headers.media
    content {
      http_header {
        http_header_name = condition.key
        values           = [condition.value]
      }
    }
  }
}
