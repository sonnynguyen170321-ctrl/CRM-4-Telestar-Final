# VPC with one public subnet (EC2 host, reaches the internet via IGW — needed for
# enrichment fetch + SMTP/IMAP egress) and two private subnets across two AZs (RDS +
# ElastiCache subnet groups both require >= 2 AZs). No NAT gateway: RDS/ElastiCache need
# no outbound internet, and the EC2 host egresses directly through the IGW.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name  = "${var.project}-${var.env}"
  az_a  = data.aws_availability_zones.available.names[0]
  az_b  = data.aws_availability_zones.available.names[1]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 0) # 10.20.0.0/24
  availability_zone       = local.az_a
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-a" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10) # 10.20.10.0/24
  availability_zone = local.az_a
  tags              = { Name = "${local.name}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 11) # 10.20.11.0/24
  availability_zone = local.az_b
  tags              = { Name = "${local.name}-private-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Private subnets get no default route (no internet). They only need to reach the EC2 SG.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-private-rt" }
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private.id
}
