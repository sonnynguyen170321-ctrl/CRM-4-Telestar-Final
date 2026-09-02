terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Optional: use an S3 backend for shared state. Left local by default so a first
  # `terraform init` works with zero setup. Uncomment + fill to share state across a team.
  # backend "s3" {
  #   bucket = "telestar-tfstate"
  #   key    = "aws-ec2/terraform.tfstate"
  #   region = "ap-southeast-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
