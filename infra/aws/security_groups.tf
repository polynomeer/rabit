resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public HTTPS load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "Redirected to HTTPS"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  for_each                     = { api = aws_security_group.api.id, media = aws_security_group.media.id }
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = local.ports[each.key]
  to_port                      = local.ports[each.key]
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "api tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "media" {
  name        = "${local.name}-media"
  description = "media gateway tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  for_each                     = { api = aws_security_group.api.id, media = aws_security_group.media.id }
  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.ports[each.key]
  to_port                      = local.ports[each.key]
}

# api and media reach the internet through NAT (OIDC JWKS, AWS APIs).
resource "aws_vpc_security_group_egress_rule" "api_media_https" {
  for_each          = { api = aws_security_group.api.id, media = aws_security_group.media.id }
  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# The worker processes untrusted media (ADR-0007): no ingress; egress only to the
# database, S3 (prefix list) and the interface endpoints.
resource "aws_security_group" "worker" {
  name        = "${local.name}-worker"
  description = "Isolated media-processing worker"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "worker_s3" {
  security_group_id = aws_security_group.worker.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.s3.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "worker_endpoints" {
  security_group_id            = aws_security_group.worker.id
  referenced_security_group_id = aws_security_group.endpoints.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "to_db" {
  for_each = {
    api    = aws_security_group.api.id
    media  = aws_security_group.media.id
    worker = aws_security_group.worker.id
  }
  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-endpoints"
  description = "VPC interface endpoints"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_https" {
  security_group_id = aws_security_group.endpoints.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "PostgreSQL"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_tasks" {
  for_each = {
    api    = aws_security_group.api.id
    media  = aws_security_group.media.id
    worker = aws_security_group.worker.id
  }
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
