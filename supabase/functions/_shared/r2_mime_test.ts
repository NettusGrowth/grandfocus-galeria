import { responseContentTypeForKey } from './r2_mime.ts'

Deno.test('responseContentTypeForKey maps supported object extensions', () => {
  const cases: Array<[string, string]> = [
    ['abc/PHOTO.JPG', 'image/jpeg'],
    ['abc/photo.jpeg', 'image/jpeg'],
    ['abc/photo.png', 'image/png'],
    ['abc/preview.webp', 'image/webp'],
    ['selecoes/abc/contrato.pdf', 'application/pdf'],
    ['abc/video.mp4', 'video/mp4'],
    ['abc/unknown.bin', 'application/octet-stream'],
    ['abc/no-extension', 'application/octet-stream'],
  ]

  for (const [key, expected] of cases) {
    const actual = responseContentTypeForKey(key)
    if (actual !== expected) {
      throw new Error(`Expected ${key} to map to ${expected}, got ${actual}`)
    }
  }
})
