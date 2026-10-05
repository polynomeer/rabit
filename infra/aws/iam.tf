data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# Used by ECS itself: pull the image, write logs, read the injected secrets.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn, aws_db_instance.main.master_user_secret[0].secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# What each role's code may do in S3 (least privilege per role, ADR-0007).
locals {
  bucket_arn = { for ns, b in aws_s3_bucket.ns : ns => b.arn }

  s3_access = {
    # Presigns uploads to quarantine and checks/cancels them; reads waveforms and
    # export archives it hands out as presigned downloads.
    api = {
      read   = ["quarantine", "private-media", "catalog-media", "exports"]
      write  = ["quarantine"]
      delete = ["quarantine"]
    }
    # Streams HLS from the media buckets only.
    media = {
      read   = ["private-media", "catalog-media"]
      write  = []
      delete = []
    }
    # Validates, transcodes, exports and deletes (prefix sweeps).
    worker = {
      read   = local.namespaces
      write  = local.namespaces
      delete = local.namespaces
    }
  }
}

resource "aws_iam_role" "task" {
  for_each           = local.s3_access
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  for_each = local.s3_access

  statement {
    sid       = "Read"
    actions   = ["s3:GetObject", "s3:GetObjectAttributes"]
    resources = [for ns in each.value.read : "${local.bucket_arn[ns]}/*"]
  }

  statement {
    sid       = "List"
    actions   = ["s3:ListBucket"]
    resources = [for ns in distinct(concat(each.value.read, each.value.delete)) : local.bucket_arn[ns]]
  }

  dynamic "statement" {
    for_each = length(each.value.write) > 0 ? [1] : []
    content {
      sid       = "Write"
      actions   = ["s3:PutObject"]
      resources = [for ns in each.value.write : "${local.bucket_arn[ns]}/*"]
    }
  }

  dynamic "statement" {
    for_each = length(each.value.delete) > 0 ? [1] : []
    content {
      sid       = "Delete"
      actions   = ["s3:DeleteObject"]
      resources = [for ns in each.value.delete : "${local.bucket_arn[ns]}/*"]
    }
  }

  statement {
    sid       = "Key"
    actions   = length(each.value.write) > 0 ? ["kms:Decrypt", "kms:GenerateDataKey"] : ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
}

resource "aws_iam_role_policy" "task" {
  for_each = local.s3_access
  name     = "s3"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.task[each.key].json
}
