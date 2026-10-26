// Server-side Cloudflare R2 helpers for private objects.
// All R2 credentials must remain in Edge Function secrets; never expose them to the browser.
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'
import { responseContentTypeForKey } from './r2_mime.ts'

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

export async function r2ObjectExists(key: string): Promise<boolean> {
  validateKey(key)
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.Code === 'NotFound') return false
    throw error
  }
}

export async function signR2Object(
  key: string,
  expiresIn = 3600,
  downloadName?: string | null,
): Promise<string> {
  validateKey(key)
  const safeName = typeof downloadName === 'string'
    ? downloadName.replaceAll('\r', '').replaceAll('\n', '').replaceAll('"', '').replaceAll('\\', '').slice(0, 180)
    : ''
  const responseContentDisposition = safeName
    ? `attachment; filename="${safeName}"`
    : undefined
  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // A cópia inicial de 2.225 objetos preservou os bytes, mas gravou
      // application/octet-stream como metadado. Esse override assinado
      // devolve o MIME correto sem retransferir os 14,6 GB existentes.
      ResponseContentType: responseContentTypeForKey(key),
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
  if (!contentType || contentType.length > 150 || contentType.includes('\r') || contentType.includes('\n')) {
    throw new Error('Invalid content type')
  }
  return await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    {
      expiresIn,
      // The browser must send exactly the Content-Type covered by the signature.
      signableHeaders: new Set(['content-type']),
    },
  )
}

export async function deleteR2Objects(keys: string[]): Promise<void> {
  for (const key of keys) validateKey(key)
  await Promise.all(keys.map((key) =>
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  ))
}
