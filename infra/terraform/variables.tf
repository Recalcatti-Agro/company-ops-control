variable "aws_region" {
  description = "AWS region where the infrastructure will be created."
  type        = string
  default     = "us-east-1"
}

variable "project_slug" {
  description = "Lowercase slug used to build resource names."
  type        = string
  default     = "recalcatti-agro"
}

variable "environment" {
  description = "Environment name used in tags and names."
  type        = string
  default     = "prod"
}

variable "instance_name" {
  description = "Lightsail instance name."
  type        = string
  default     = "ops-control-prod"
}

variable "static_ip_name" {
  description = "Lightsail static IP name."
  type        = string
  default     = "ops-control-prod-ip"
}

variable "lightsail_availability_zone" {
  description = "Lightsail availability zone."
  type        = string
  default     = "us-east-1a"
}

variable "lightsail_blueprint_id" {
  description = "Lightsail blueprint id."
  type        = string
  default     = "ubuntu_24_04"
}

variable "lightsail_bundle_id" {
  description = "Lightsail bundle id. For the current setup, use the 1 GB / 2 vCPU / 40 GB plan."
  type        = string
  default     = "medium_2_0"
}

variable "lightsail_key_pair_name" {
  description = "Existing Lightsail key pair name to attach to the instance."
  type        = string
}

variable "backup_bucket_name" {
  description = "S3 bucket name for database backups. Leave null to auto-generate one."
  type        = string
  default     = null
}

variable "backup_prefix" {
  description = "S3 prefix where DB dumps are uploaded."
  type        = string
  default     = "production"
}

variable "backup_expiration_days" {
  description = "Days to retain S3 backups before lifecycle expiration."
  type        = number
  default     = 30
}

variable "backup_iam_user_name" {
  description = "IAM user name used by the Lightsail instance to upload DB backups to S3."
  type        = string
  default     = "lightsail-backup-bot"
}

variable "create_backup_access_key" {
  description = "Whether Terraform should create an IAM access key for the backup user."
  type        = bool
  default     = false
}

variable "monthly_budget_limit_usd" {
  description = "Monthly AWS budget limit in USD."
  type        = string
  default     = "12"
}

variable "enable_budget" {
  description = "Whether to create a monthly AWS budget."
  type        = bool
  default     = true
}

variable "budget_alert_email" {
  description = "Email that receives budget alerts. Required if enable_budget is true."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags applied to supported resources."
  type        = map(string)
  default     = {}
}
