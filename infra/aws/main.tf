locals {
  name = "rabit-${var.environment}"

  # Logical namespaces (ADR-0004) → this environment's buckets.
  namespaces = ["quarantine", "private-originals", "private-media", "catalog-originals", "catalog-media", "exports"]
  buckets    = { for ns in local.namespaces : ns => "${var.bucket_prefix}-${ns}" }

  hosts = {
    api          = "api.${var.domain}"
    media        = "media.${var.domain}"
    media_origin = "media-origin.${var.domain}"
    app          = "app.${var.domain}"
  }

  ports = { api = 8080, media = 8081, metrics = 9464 }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
