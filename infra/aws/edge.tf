# Certificates: the load balancer's in the region, CloudFront's in us-east-1.
resource "aws_acm_certificate" "regional" {
  domain_name               = local.hosts.api
  subject_alternative_names = [local.hosts.media_origin]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "edge" {
  provider                  = aws.us_east_1
  domain_name               = local.hosts.media
  subject_alternative_names = [local.hosts.app]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

locals {
  validation_records = merge(
    { for o in aws_acm_certificate.regional.domain_validation_options : o.domain_name => o },
    { for o in aws_acm_certificate.edge.domain_validation_options : o.domain_name => o },
  )
}

resource "aws_route53_record" "validation" {
  for_each        = local.validation_records
  zone_id         = var.hosted_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "regional" {
  certificate_arn         = aws_acm_certificate.regional.arn
  validation_record_fqdns = [for o in aws_acm_certificate.regional.domain_validation_options : aws_route53_record.validation[o.domain_name].fqdn]
}

resource "aws_acm_certificate_validation" "edge" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.edge.arn
  validation_record_fqdns = [for o in aws_acm_certificate.edge.domain_validation_options : aws_route53_record.validation[o.domain_name].fqdn]
}

# ---- media: CloudFront → load balancer (ADR-0008) ----
# Each URL carries its own session token, so nothing is shared between sessions:
# CloudFront is there for egress price and latency. Caching is disabled; the
# media role's own cache headers still apply to the viewer.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name} media"
  aliases         = [local.hosts.media]
  price_class     = "PriceClass_200" # includes Korea and Japan edges

  origin {
    origin_id   = "media"
    domain_name = local.hosts.media_origin
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id         = "media"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.edge.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---- web reference client: S3 (private) behind CloudFront ----
resource "aws_s3_bucket" "web" {
  bucket = "${var.bucket_prefix}-web"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# The web client's Content-Security-Policy comes from infra/web/csp.json, the file
# the E2E suite serves to the production build (apps/web/e2e/csp.spec.ts).
locals {
  csp_policy = { for d, sources in jsondecode(file("${path.module}/../web/csp.json")) : d => sources if d != "//" }
  csp_origins = {
    "{api}"    = "https://${local.hosts.api}"
    "{media}"  = "https://${local.hosts.media}"
    "{oidc}"   = regex("^https?://[^/]+", var.auth_issuer)
    "{upload}" = "https://${local.buckets.quarantine}.s3.${var.region}.amazonaws.com"
  }
  content_security_policy = join("; ", [
    for d, sources in local.csp_policy : "${d} ${join(" ", distinct([for s in sources : lookup(local.csp_origins, s, s)]))}"
  ])
}

resource "aws_cloudfront_response_headers_policy" "web" {
  name = "${local.name}-web"
  security_headers_config {
    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name} web"
  aliases             = [local.hosts.app]
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.edge.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# ---- DNS ----
resource "aws_route53_record" "alb" {
  for_each = toset([local.hosts.api, local.hosts.media_origin])
  zone_id  = var.hosted_zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "cdn" {
  for_each = {
    (local.hosts.media) = aws_cloudfront_distribution.media
    (local.hosts.app)   = aws_cloudfront_distribution.web
  }
  zone_id = var.hosted_zone_id
  name    = each.key
  type    = "A"
  alias {
    name                   = each.value.domain_name
    zone_id                = each.value.hosted_zone_id
    evaluate_target_health = false
  }
}
