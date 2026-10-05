# One customer-managed key for this environment's data at rest: S3 (SSE-KMS),
# RDS storage and the application secret (NFR-SEC-004). Per-workspace scope: ADR-0021.
resource "aws_kms_key" "data" {
  description             = "${local.name} data at rest"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}
