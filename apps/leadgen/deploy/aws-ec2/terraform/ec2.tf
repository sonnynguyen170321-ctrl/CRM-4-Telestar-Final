data "aws_caller_identity" "current" {}

# Amazon Linux 2023 (x86_64) — ships the SSM agent; we install docker + compose in user_data.
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-x86_64"] # standard AL2023 (excludes the -minimal- variant)
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# Elastic IP allocated independently of the instance so its address is known before the
# instance boots (user_data derives the public sslip.io hostname from it).
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${local.name}-eip" }
}

locals {
  # 13.250.1.2 -> 13-250-1-2.sslip.io  (resolves back to the IP; Caddy gets a real cert)
  app_domain = "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
  app_url    = "https://${local.app_domain}"
}

# S3 bucket holding the deploy bundle (compose file + Caddyfile + deploy.sh). CI uploads it;
# the host syncs it before each deploy. Keeps a GitHub token off the box.
resource "aws_s3_bucket" "deploy" {
  bucket        = "${local.name}-deploy-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = { Name = "${local.name}-deploy" }
}

resource "aws_s3_bucket_public_access_block" "deploy" {
  bucket                  = aws_s3_bucket.deploy.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Instance IAM role: SSM + read the app secret + pull ECR + read the deploy bundle ---
resource "aws_iam_role" "ec2" {
  name = "${local.name}-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_app" {
  name = "${local.name}-ec2-app"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadAppSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.app_env.arn]
      },
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
      },
      {
        Sid    = "EcrPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ]
        Resource = [aws_ecr_repository.app.arn]
      },
      {
        Sid      = "ReadDeployBundle"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.deploy.arn, "${aws_s3_bucket.deploy.arn}/*"]
      },
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name}-ec2"
  role = aws_iam_role.ec2.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    region        = var.aws_region
    secret_id     = aws_secretsmanager_secret.app_env.arn
    ecr_repo_url  = aws_ecr_repository.app.repository_url
    app_domain    = local.app_domain
    deploy_bucket = aws_s3_bucket.deploy.bucket
  })
  # Re-run user_data when its inputs change (recreates the instance).
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${local.name}-app"
    Role = "app-host" # SSM SendCommand targets instances by this tag
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
