import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner"
import { logger } from "../../utils/logger.ts"
import { recordUsageEvent } from "../usage/recordUsageEvent.ts"
import { USAGE_EVENT_TYPE } from "../../types/usage.ts"

let s3Client: S3Client | null = null

function getS3Client(): S3Client | null {
  if (s3Client) return s3Client

  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accountId || !accessKeyId || !secretAccessKey) {
    logger.warn("R2 credentials not configured — file uploads will be skipped")
    return null
  }

  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })

  return s3Client
}

function getBucketName(): string {
  return process.env.R2_BUCKET_NAME || "ventory-invoices"
}

/**
 * Upload an invoice file to R2 storage.
 * Key pattern: {tenant_id}/{invoice_id}/{filename}
 * Returns the object key (not full URL).
 */
export async function uploadInvoiceFile(
  tenantId: string,
  invoiceId: string,
  buffer: Buffer,
  contentType: string,
  filename: string
): Promise<string | null> {
  const client = getS3Client()
  if (!client) {
    logger.warn("R2 not configured, skipping file upload")
    return null
  }

  const key = `${tenantId}/${invoiceId}/${filename}`

  await client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  logger.info({ key, contentType }, "Invoice file uploaded to R2")

  await recordUsageEvent({
    tenantId,
    eventType: USAGE_EVENT_TYPE.file_storage,
    quantity: buffer.length,
    metadata: { invoiceId, filename, contentType },
  })

  return key
}

/**
 * Get a time-limited signed URL for viewing an invoice file.
 * Validates that the key belongs to the specified tenant.
 * Default expiry: 1 hour.
 */
export async function getSignedUrl(key: string, tenantId?: string, expiresIn = 3600): Promise<string | null> {
  // Validate tenant ownership of the file key
  if (tenantId && !key.startsWith(`${tenantId}/`)) {
    logger.warn({ key, tenantId }, "Attempted to access file belonging to another tenant")
    return null
  }

  const client = getS3Client()
  if (!client) {
    // Fall back to public URL if configured
    const publicUrl = process.env.R2_PUBLIC_URL
    if (publicUrl) {
      return `${publicUrl}/${key}`
    }
    return null
  }

  const url = await awsGetSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
    { expiresIn }
  )

  return url
}

/**
 * Download a file from R2 as a Buffer.
 */
export async function downloadFile(key: string): Promise<Buffer | null> {
  const client = getS3Client()
  if (!client) return null

  const response = await client.send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    })
  )

  if (!response.Body) return null

  const chunks: Uint8Array[] = []
  // @ts-expect-error Body is a readable stream in Node.js
  for await (const chunk of response.Body) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
