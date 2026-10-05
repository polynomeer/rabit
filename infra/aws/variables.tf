variable "environment" {
  description = "Environment name: staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "AWS region. Seoul for the first launch (ADR-0012)."
  type        = string
  default     = "ap-northeast-2"
}

variable "availability_zones" {
  description = "Two availability zones in the region."
  type        = list(string)
  default     = ["ap-northeast-2a", "ap-northeast-2c"]
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "single_nat_gateway" {
  description = "One NAT gateway for both zones (cheaper, not zone-redundant). Use false for production."
  type        = bool
  default     = true
}

variable "interface_endpoint_az_count" {
  description = "Zones that get interface endpoints (USD 0.013/h each per service). 1 is enough for staging; tasks in the other zone reach it across zones."
  type        = number
  default     = 1
}

variable "domain" {
  description = "Apex domain in Route 53, e.g. rabit.example. Hosts: api., media., media-origin., app."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone for var.domain."
  type        = string
}

variable "bucket_prefix" {
  description = "S3 bucket name prefix (S3_BUCKET_PREFIX); bucket names are global."
  type        = string
}

variable "image_tag" {
  description = "Initial image tag for the task definitions. Later deploys register new revisions from CI."
  type        = string
  default     = "bootstrap"
}

variable "cpu_architecture" {
  description = "ARM64 is ~20% cheaper on Fargate; the image must be built for it."
  type        = string
  default     = "ARM64"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_performance_insights" {
  description = "Performance Insights (not available on every small instance class)."
  type        = bool
  default     = false
}

variable "db_multi_az" {
  description = "Multi-AZ standby. Required from external launch (NFR-REL-008)."
  type        = bool
  default     = false
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "media_desired_count" {
  type    = number
  default = 1
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "task_sizes" {
  description = "Fargate CPU units / memory MiB per role."
  type = map(object({
    cpu    = number
    memory = number
  }))
  default = {
    api    = { cpu = 512, memory = 1024 }
    media  = { cpu = 512, memory = 1024 }
    worker = { cpu = 1024, memory = 2048 }
  }
}

variable "worker_concurrency" {
  type    = number
  default = 2
}

variable "auth_issuer" {
  description = "OIDC issuer URL of the production identity provider (ADR-0009; provider still to be chosen)."
  type        = string
}

variable "auth_audience" {
  type    = string
  default = "rabit-api"
}

variable "auth_jwks_url" {
  description = "JWKS URL of the identity provider."
  type        = string
}

variable "github_repository" {
  description = "owner/name allowed to deploy through GitHub OIDC."
  type        = string
  default     = "polynomeer/rabit"
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider (false if the account already has one)."
  type        = bool
  default     = true
}

variable "budget_monthly_usd" {
  description = "Monthly cost budget; alerts at 80% actual and 100% forecast."
  type        = number
  default     = 300
}

variable "budget_alert_emails" {
  description = "Addresses that receive budget alerts."
  type        = list(string)
}

variable "alert_emails" {
  description = "Addresses that receive alerts (each must confirm the SNS subscription)."
  type        = list(string)
}

variable "collector_image_tag" {
  description = "AWS Distro for OpenTelemetry collector, pulled through the ECR cache of public.ecr.aws."
  type        = string
  default     = "v0.50.0"
}

variable "log_retention_days" {
  type    = number
  default = 30
}
