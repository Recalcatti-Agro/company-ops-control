data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  common_tags = merge(
    {
      Project     = var.project_slug
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags,
  )

  resolved_backup_bucket_name = coalesce(
    var.backup_bucket_name,
    "${var.project_slug}-db-backups-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"
  )
}

resource "aws_lightsail_instance" "app" {
  name              = var.instance_name
  availability_zone = var.lightsail_availability_zone
  blueprint_id      = var.lightsail_blueprint_id
  bundle_id         = var.lightsail_bundle_id
  key_pair_name     = var.lightsail_key_pair_name

  tags = local.common_tags
}

resource "aws_lightsail_static_ip" "app" {
  name = var.static_ip_name

  tags = local.common_tags
}

resource "aws_lightsail_static_ip_attachment" "app" {
  static_ip_name = aws_lightsail_static_ip.app.name
  instance_name  = aws_lightsail_instance.app.name
}

resource "aws_lightsail_instance_public_ports" "app" {
  instance_name = aws_lightsail_instance.app.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = ["0.0.0.0/0"]
  }

  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }
}

resource "aws_s3_bucket" "db_backups" {
  bucket = local.resolved_backup_bucket_name

  tags = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    id     = "expire-${var.backup_prefix}-backups"
    status = "Enabled"

    filter {
      prefix = "${var.backup_prefix}/"
    }

    expiration {
      days = var.backup_expiration_days
    }
  }
}

data "aws_iam_policy_document" "backup_bucket_access" {
  statement {
    sid    = "ListBackupBucket"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.db_backups.arn,
    ]
  }

  statement {
    sid    = "ReadWriteBackupObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = [
      "${aws_s3_bucket.db_backups.arn}/*",
    ]
  }
}

resource "aws_iam_policy" "backup_bucket_access" {
  name        = "${var.project_slug}-${var.environment}-backup-s3-policy"
  description = "Allows DB backup uploads to ${local.resolved_backup_bucket_name}"
  policy      = data.aws_iam_policy_document.backup_bucket_access.json

  tags = local.common_tags
}

resource "aws_iam_user" "backup" {
  name = var.backup_iam_user_name

  tags = local.common_tags
}

resource "aws_iam_user_policy_attachment" "backup_bucket_access" {
  user       = aws_iam_user.backup.name
  policy_arn = aws_iam_policy.backup_bucket_access.arn
}

resource "aws_iam_access_key" "backup" {
  count = var.create_backup_access_key ? 1 : 0
  user  = aws_iam_user.backup.name
}

resource "aws_budgets_budget" "monthly" {
  count = var.enable_budget ? 1 : 0

  name         = "${var.project_slug}-${var.environment}-monthly-budget"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = var.budget_alert_email != "" ? [80, 100] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }
}
