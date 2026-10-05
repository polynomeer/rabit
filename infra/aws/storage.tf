# Six private buckets (ADR-0004). No versioning: a deletion must remove the bytes
# (LIB-008); originals are immutable by key instead.
resource "aws_s3_bucket" "ns" {
  for_each = local.buckets
  bucket   = each.value
}

resource "aws_s3_bucket_public_access_block" "ns" {
  for_each                = aws_s3_bucket.ns
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "ns" {
  for_each = aws_s3_bucket.ns
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ns" {
  for_each = aws_s3_bucket.ns
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

# TLS only, and every write encrypted with this environment's key.
data "aws_iam_policy_document" "bucket" {
  for_each = aws_s3_bucket.ns

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyOtherEncryptionKeys"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.data.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "ns" {
  for_each   = aws_s3_bucket.ns
  bucket     = each.value.id
  policy     = data.aws_iam_policy_document.bucket[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.ns]
}

# Abandoned uploads and exports expire after 2 days (audio-pipeline §5).
resource "aws_s3_bucket_lifecycle_configuration" "ns" {
  for_each = aws_s3_bucket.ns
  bucket   = each.value.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  dynamic "rule" {
    for_each = contains(["quarantine", "exports"], each.key) ? [1] : []
    content {
      id     = "expire-after-2-days"
      status = "Enabled"
      filter {}
      expiration {
        days = 2
      }
    }
  }
}

# Browsers upload straight to quarantine with presigned PUTs (AUD-002).
resource "aws_s3_bucket_cors_configuration" "quarantine" {
  bucket = aws_s3_bucket.ns["quarantine"].id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${local.hosts.app}"]
    allowed_headers = [
      "content-type",
      "x-amz-checksum-sha256",
      "x-amz-server-side-encryption",
      "x-amz-server-side-encryption-aws-kms-key-id",
      "x-amz-server-side-encryption-bucket-key-enabled",
    ]
    max_age_seconds = 600
  }
}
