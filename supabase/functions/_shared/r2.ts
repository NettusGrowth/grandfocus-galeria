// Server-side Cloudflare R2 helpers for private objects.
// All R2 credentials must remain in Edge Function secrets; never expose them to the browser.
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'

const endpoint = Deno.env.get('R2_ENDPOINT')
const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
const bucket = Deno.env.get('R2_BUCKET') || 'grandfocus-fotos'

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`)
  return value
}

const client = new S3Client({
  region: 'auto',
  endpoint: required(endpoint, 'R2_ENDPOINT'),
  credentials: {
    accessKeyId: required(accessKeyId, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(secretAccessKey, 'R2_SECRET_ACCESS_KEY'),
  },
})

function validateKey(key: string) {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error('Invalid R2 object key')
  }
  return key
}

export async function signR2Object(
  key: string,
  expiresIn = 3600,
  downloadName?: string | null,
): Promise<string> {
  validateKey(key)
  const safeName = typeof downloadName === 'string'
    ? downloadName.replace(/[\\r\\n"\\\\]/g, '').slice(0, 180)
    : ''
  const responseContentDisposition = safeName
    ? `attachment; filename="${safeName}"`
    : undefined
  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(responseContentDisposition ? { ResponseContentDisposition: responseContentDisposition } : {}),
    }),
    { expiresIn },
  )
}

export async function signR2Upload(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  validateKey(key)
  if (!contentType || contentType.length > 150 || /[\\r\\n]/.test(contentType)) {
    throw new Error('Invalid content type')
  }
  return await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  )
}

export async function deleteR2Objects(keys: string[]): Promise<void> {
  for (const key of keys) validateKey(key)
  await Promise.all(keys.map((key) =>
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  ))
}
