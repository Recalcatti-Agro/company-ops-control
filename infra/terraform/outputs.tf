output "lightsail_instance_name" {
  description = "Lightsail instance name."
  value       = aws_lightsail_instance.app.name
}

output "lightsail_public_ip" {
  description = "Static public IPv4 assigned to the Lightsail instance."
  value       = aws_lightsail_static_ip.app.ip_address
}

output "lightsail_ssh_command" {
  description = "SSH command template for the Lightsail instance."
  value       = "ssh ubuntu@${aws_lightsail_static_ip.app.ip_address}"
}

output "backup_bucket_name" {
  description = "S3 bucket used for DB backups."
  value       = aws_s3_bucket.db_backups.bucket
}

output "backup_bucket_prefix" {
  description = "S3 prefix used by backup uploads."
  value       = var.backup_prefix
}

output "backup_iam_user_name" {
  description = "IAM user that can upload backups to S3."
  value       = aws_iam_user.backup.name
}

output "backup_access_key_id" {
  description = "Access key id for the backup IAM user, if created."
  value       = var.create_backup_access_key ? aws_iam_access_key.backup[0].id : null
  sensitive   = true
}

output "backup_secret_access_key" {
  description = "Secret access key for the backup IAM user, if created."
  value       = var.create_backup_access_key ? aws_iam_access_key.backup[0].secret : null
  sensitive   = true
}
