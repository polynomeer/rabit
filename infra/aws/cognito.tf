# Sign-in on Amazon Cognito (ADR-0009): a user pool for listeners and a separate
# operator pool where every sign-in needs MFA. The api trusts both issuers with
# AUTH_PROFILE=cognito; roles come only from the operator pool.

resource "aws_cognito_user_pool" "users" {
  name                     = "${local.name}-users"
  user_pool_tier           = "LITE"
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  # A changed email stays unverified until confirmed; the old one keeps working.
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_uppercase                = false
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool" "operators" {
  name                     = "${local.name}-operators"
  user_pool_tier           = "LITE"
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  # NFR-SEC-007: every operator sign-in uses an authenticator app.
  mfa_configuration = "ON"

  software_token_mfa_configuration {
    enabled = true
  }

  # No self sign-up: operators are created by an administrator (owner-actions O-03).
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 16
    require_lowercase                = true
    require_numbers                  = true
    require_uppercase                = true
    require_symbols                  = true
    temporary_password_validity_days = 1
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }
}

# Hosted sign-in pages: https://<prefix>.auth.<region>.amazoncognito.com
resource "aws_cognito_user_pool_domain" "users" {
  domain       = "${var.bucket_prefix}-login"
  user_pool_id = aws_cognito_user_pool.users.id
}

resource "aws_cognito_user_pool_domain" "operators" {
  domain       = "${var.bucket_prefix}-ops-login"
  user_pool_id = aws_cognito_user_pool.operators.id
}

locals {
  app_url = "https://${local.hosts.app}/"

  # Public browser clients: Authorization Code + PKCE, no secret (ADR-0009).
  cognito_clients = {
    users     = { pool = aws_cognito_user_pool.users.id, refresh_hours = 720 }
    operators = { pool = aws_cognito_user_pool.operators.id, refresh_hours = 12 }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  for_each                             = local.cognito_clients
  name                                 = "${local.name}-${each.key}-web"
  user_pool_id                         = each.value.pool
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [local.app_url]
  logout_urls                          = [local.app_url]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 60
  id_token_validity                    = 60
  refresh_token_validity               = each.value.refresh_hours

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }
}

locals {
  cognito_issuer = {
    users     = "https://${aws_cognito_user_pool.users.endpoint}"
    operators = "https://${aws_cognito_user_pool.operators.endpoint}"
  }
  # Origins the browser talks to during sign-in: discovery and keys on cognito-idp,
  # authorize and token on each pool's hosted domain (connect-src in the CSP).
  cognito_origins = join(" ", [
    "https://cognito-idp.${var.region}.amazonaws.com",
    "https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com",
    "https://${aws_cognito_user_pool_domain.operators.domain}.auth.${var.region}.amazoncognito.com",
  ])
}
