import { signR2Object, signR2Upload } from './r2.ts'

Deno.test('signed GET sets correct response content type for migrated images', async () => {
  const url = new URL(await signR2Object('597e1703-98bf-446b-95f3-b31c414785a6/photo.jpg', 300))
  if (url.searchParams.get('response-content-type') !== 'image/jpeg') {
    throw new Error(`Expected response-content-type=image/jpeg; got ${url.searchParams.get('response-content-type')}`)
  }
  if (!url.searchParams.has('X-Amz-Signature')) {
    throw new Error('Expected a SigV4 signature in the URL')
  }
})

Deno.test('signed GET preserves a requested download filename', async () => {
  const url = new URL(await signR2Object('597e1703-98bf-446b-95f3-b31c414785a6/photo.png', 300, 'foto-final.png'))
  if (url.searchParams.get('response-content-disposition') !== 'attachment; filename="foto-final.png"') {
    throw new Error('Expected the requested safe download filename in response-content-disposition')
  }
})

Deno.test('signed PUT binds the expected content type', async () => {
  const url = new URL(await signR2Upload('597e1703-98bf-446b-95f3-b31c414785a6/new-photo.jpg', 'image/jpeg', 300))
  if (url.searchParams.get('X-Amz-Signature') === null) {
    throw new Error('Expected a SigV4 signature in the upload URL')
  }
  const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') || ''
  if (!signedHeaders.split(';').includes('content-type')) {
    throw new Error(`Expected content-type to be signed; got ${signedHeaders}`)
  }
})
