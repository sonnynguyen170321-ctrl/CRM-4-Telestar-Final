# RDS PostgreSQL 16. Password is generated here and only ever lands in Secrets Manager
# (see secrets.tf) — it is never printed by an output. override_special keeps the value
# URL-safe so it drops cleanly into the DATABASE_URL DSN.

resource "random_password" "db" {
  length           = 24
  special          = true
  override_special = "-_"
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  tags       = { Name = "${local.name}-db" }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-pg"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 3 # allow autoscaling headroom
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # single-AZ for cost; flip to true for HA

  backup_retention_period = 7
  skip_final_snapshot     = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name}-pg-final"
  deletion_protection     = false
  apply_immediately       = true

  tags = { Name = "${local.name}-pg" }
}
