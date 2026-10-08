# Certificates (only with a domain): the load balancer's in the region,
# CloudFront's in us-east-1. Without a domain CloudFront uses its default
# certificate for *.cloudfront.net.
resource "aws_acm_certificate" "regional" {
  count                     = local.use_domain ? 1 : 0
  domain_name               = local.domain_hosts.api
  subject_alternative_names = [local.domain_hosts.media_origin]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "edge" {
  count                     = local.use_domain ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = local.domain_hosts.media
  subject_alternative_names = [local.domain_hosts.app]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

locals {
  validation_records = {
    for o in flatten(concat(aws_acm_certificate.regional[*].domain_validation_options, aws_acm_certificate.edge[*].domain_validation_options)) :
    o.domain_name => o
  }
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
  count                   = local.use_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.regional[0].arn
  validation_record_fqdns = [for o in aws_acm_certificate.regional[0].domain_validation_options : aws_route53_record.validation[o.domain_name].fqdn]
}

resource "aws_acm_certificate_validation" "edge" {
  count                   = local.use_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.edge[0].arn
  validation_record_fqdns = [for o in aws_acm_certificate.edge[0].domain_validation_options : aws_route53_record.validation[o.domain_name].fqdn]
}

locals {
  # Viewer side: our certificate with a domain, CloudFront's default otherwise
  # (which only allows the TLSv1 setting; viewers still negotiate TLS 1.2+).
  edge_certificate = local.use_domain ? {
    acm_certificate_arn = aws_acm_certificate_validation.edge[0].certificate_arn
    ssl_support_method  = "sni-only"
    minimum_protocol    = "TLSv1.2_2021"
    } : {
    acm_certificate_arn = null
    ssl_support_method  = null
    minimum_protocol    = "TLSv1"
  }
  # Origin side: HTTPS to media-origin.<domain>, or HTTP to the load balancer's
  # own name, which only answers CloudFront's address ranges and the secret header.
  lb_origin = local.use_domain ? {
    domain_name = local.domain_hosts.media_origin
    protocol    = "https-only"
    } : {
    domain_name = aws_lb.main.dns_name
    protocol    = "http-only"
  }
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
  aliases         = local.use_domain ? [local.domain_hosts.media] : []
  price_class     = "PriceClass_200" # includes Korea and Japan edges

  origin {
    origin_id   = "media"
    domain_name = local.lb_origin.domain_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = local.lb_origin.protocol
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_verify.result
    }
    custom_header {
      name  = "x-origin-role"
      value = "media"
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
    cloudfront_default_certificate = !local.use_domain
    acm_certificate_arn            = local.edge_certificate.acm_certificate_arn
    ssl_support_method             = local.edge_certificate.ssl_support_method
    minimum_protocol_version       = local.edge_certificate.minimum_protocol
  }
}

# ---- api without a domain: CloudFront → load balancer ----
# With a domain the api is served by the load balancer at api.<domain>. Without
# one, CloudFront gives it an HTTPS name. Nothing is cached; every viewer header
# but Host (Authorization included) goes to the api.
resource "aws_cloudfront_distribution" "api" {
  count           = local.use_domain ? 0 : 1
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name} api"
  price_class     = "PriceClass_200"

  origin {
    origin_id   = "api"
    domain_name = aws_lb.main.dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_verify.result
    }
    custom_header {
      name  = "x-origin-role"
      value = "api"
    }
  }

  default_cache_behavior {
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
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
    cloudfront_default_certificate = true
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
    "{api}"    = "https://${local.api_host}"
    "{media}"  = "https://${local.media_host}"
    "{oidc}"   = local.cognito_origins
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
  aliases             = local.use_domain ? [local.domain_hosts.app] : []
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
    cloudfront_default_certificate = !local.use_domain
    acm_certificate_arn            = local.edge_certificate.acm_certificate_arn
    ssl_support_method             = local.edge_certificate.ssl_support_method
    minimum_protocol_version       = local.edge_certificate.minimum_protocol
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

# ---- DNS (only with a domain) ----
resource "aws_route53_record" "alb" {
  for_each = local.use_domain ? toset([local.domain_hosts.api, local.domain_hosts.media_origin]) : toset([])
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
  for_each = local.use_domain ? {
    (local.domain_hosts.media) = { name = aws_cloudfront_distribution.media.domain_name, zone = aws_cloudfront_distribution.media.hosted_zone_id }
    (local.domain_hosts.app)   = { name = aws_cloudfront_distribution.web.domain_name, zone = aws_cloudfront_distribution.web.hosted_zone_id }
  } : {}
  zone_id = var.hosted_zone_id
  name    = each.key
  type    = "A"
  alias {
    name                   = each.value.name
    zone_id                = each.value.zone
    evaluate_target_health = false
  }
}
