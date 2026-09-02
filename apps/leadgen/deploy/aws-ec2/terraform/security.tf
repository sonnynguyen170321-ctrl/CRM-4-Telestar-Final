# Security groups. The EC2 host is the only public ingress (80/443). RDS + Redis accept
# traffic ONLY from the EC2 SG — never from the internet. No SSH (22): management is via
# SSM Session Manager (the instance profile includes AmazonSSMManagedInstanceCore).

resource "aws_security_group" "ec2" {
  name        = "${local.name}-ec2"
  description = "App host: inbound web, all egress."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP (ACME challenge + redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_web_cidrs
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_web_cidrs
  }

  egress {
    description = "All outbound (ECR pull, enrichment fetch, SMTP/IMAP, RDS, Redis)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-ec2" }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Postgres from the app host only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from EC2 host"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-rds" }
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis from the app host only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from EC2 host"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-redis" }
}
