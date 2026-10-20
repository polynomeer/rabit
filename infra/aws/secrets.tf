# Application secrets (R14). Generated here and kept in the encrypted state; rotate
# by tainting the random_password and redeploying (media tokens live ≤ 60 s, cursors
# are re-issued on the next page request).
resource "random_password" "app" {
  # MEDIA_EDGE_SECRET: the CDN's segment origin header (ADR-0008 amendment 2026-10-20).
  for_each = toset(["MEDIA_TOKEN_SECRET", "CURSOR_SECRET", "MEDIA_EDGE_SECRET"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app" {
  name       = "${local.name}/app"
  kms_key_id = aws_kms_key.data.arn
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ for k, v in random_password.app : k => v.result })
}
