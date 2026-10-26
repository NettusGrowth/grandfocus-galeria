// Server-side Cloudflare R2 URL signing for private objects.
// Required Edge Function secrets: R2_ENDPOINT, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET (usually "grandfocus-fotos").
// Never expose these values to the browser.
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3'
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

export async function signR2Object(key: string, expiresIn = 3600): Promise<string> {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..')) {
    throw new Error('Invalid R2 object key')
  }
  return await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  )
}
