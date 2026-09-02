variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-southeast-1" # Singapore — lowest latency to Vietnam
}

variable "project" {
  description = "Short project slug used to name/tag resources."
  type        = string
  default     = "telestar"
}

variable "env" {
  description = "Environment name (prod/staging)."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "instance_type" {
  description = "EC2 instance type running the docker-compose stack (web + worker + imap + caddy)."
  type        = string
  default     = "t3.medium" # 2 vCPU / 4 GiB — enough for web + workers at low volume
}

variable "root_volume_gb" {
  description = "EC2 root EBS volume size (GiB)."
  type        = number
  default     = 30
}

variable "db_instance_class" {
  description = "RDS PostgreSQL instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage (GiB)."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "telestar"
}

variable "db_username" {
  description = "RDS master username."
  type        = string
  default     = "telestar"
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "allowed_web_cidrs" {
  description = "CIDRs allowed to reach the app on 80/443. Default is open; tighten to your office IP(s)."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "github_repo" {
  description = "owner/repo that the GitHub Actions OIDC deploy role may be assumed from."
  type        = string
  default     = "BrandNg/telestar-company-filter"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. Set false if it already exists in the account."
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip the final RDS snapshot on destroy (true = easy teardown for a first environment)."
  type        = bool
  default     = true
}
