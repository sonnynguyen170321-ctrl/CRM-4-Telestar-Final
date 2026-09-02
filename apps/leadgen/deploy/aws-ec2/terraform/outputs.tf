output "app_url" {
  description = "Public HTTPS URL of the app (sslip.io + the Elastic IP)."
  value       = local.app_url
}

output "app_domain" {
  description = "Public hostname Caddy serves (set as APP_DOMAIN + GH var NEXT_PUBLIC_APP_URL host)."
  value       = local.app_domain
}

output "elastic_ip" {
  description = "Elastic IP of the app host."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "EC2 instance id (SSM SendCommand target)."
  value       = aws_instance.app.id
}

output "ecr_repository_url" {
  description = "ECR repo the CI workflow pushes to (GH var ECR_REPOSITORY / registry)."
  value       = aws_ecr_repository.app.repository_url
}

output "deploy_bucket" {
  description = "S3 bucket CI uploads the deploy bundle to (GH var DEPLOY_BUCKET)."
  value       = aws_s3_bucket.deploy.bucket
}

output "secret_arn" {
  description = "Secrets Manager ARN of the runtime env bundle."
  value       = aws_secretsmanager_secret.app_env.arn
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC (GH secret AWS_ROLE_ARN)."
  value       = aws_iam_role.github_deploy.arn
}

output "rds_endpoint" {
  description = "RDS endpoint (already baked into the secret's DATABASE_URL)."
  value       = aws_db_instance.main.address
}

output "redis_endpoint" {
  description = "ElastiCache primary endpoint (already baked into the secret's REDIS_URL)."
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}
