locals {
  name = "rabit-${var.environment}"

  # Logical namespaces (ADR-0004) → this environment's buckets.
  namespaces = ["quarantine", "private-originals", "private-media", "catalog-originals", "catalog-media", "exports"]
  buckets    = { for ns in local.namespaces : ns => "${var.bucket_prefix}-${ns}" }

  # With a domain: our own names, certificates and DNS records. Without one
  # (staging only, until the owner registers a domain): CloudFront's default
  # names, and CloudFront reaches the load balancer over HTTP with the secret
  # header (ADR-0012, "Staging without a domain").
  use_domain = var.domain != ""
  domain_hosts = {
    api          = "api.${var.domain}"
    media        = "media.${var.domain}"
    media_origin = "media-origin.${var.domain}"
    app          = "app.${var.domain}"
  }
  # One local per host, so a distribution never depends on its own name.
  api_host         = local.use_domain ? local.domain_hosts.api : aws_cloudfront_distribution.api[0].domain_name
  media_host       = local.use_domain ? local.domain_hosts.media : aws_cloudfront_distribution.media.domain_name
  app_host         = local.use_domain ? local.domain_hosts.app : aws_cloudfront_distribution.web.domain_name
  media_origin_url = local.use_domain ? "https://${local.domain_hosts.media_origin}" : "http://${aws_lb.main.dns_name}"
  hosts            = { api = local.api_host, media = local.media_host, app = local.app_host }

  ports = { api = 8080, media = 8081, metrics = 9464 }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
