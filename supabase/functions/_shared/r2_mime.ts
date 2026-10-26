// Infer a safe HTTP response MIME type from the stored object key.
// The initial R2 copy preserved bytes but stored application/octet-stream metadata.
export function responseContentTypeForKey(key: string): string {
  const filename = key.toLowerCase().split('/').pop() || ''
  const extension = filename.includes('.') ? filename.split('.').pop() || '' : ''
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'pdf':
      return 'application/pdf'
    case 'mp4':
      return 'video/mp4'
    default:
      return 'application/octet-stream'
  }
}
