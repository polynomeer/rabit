# Rabit on AWS Seoul (ADR-0012). OpenTofu >= 1.10 (S3 backend with native locking).
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }

  # State lives in a separate, pre-created bucket (see README). Partial config:
  #   tofu init -backend-config=environments/<env>.backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      project     = "rabit"
      environment = var.environment
      managed_by  = "opentofu"
    }
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      project     = "rabit"
      environment = var.environment
      managed_by  = "opentofu"
    }
  }
}
