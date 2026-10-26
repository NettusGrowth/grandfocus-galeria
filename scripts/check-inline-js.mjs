import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync('index.html', 'utf8')
const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
const inline = tags.filter(([, attrs]) => {
  if (/\bsrc\s*=/i.test(attrs)) return false
  const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]
  return !type || /(?:java|ecma)script/i.test(type)
})
if (!inline.length) throw new Error('Nenhum bloco JavaScript inline foi encontrado.')
for (let i = 0; i < inline.length; i++) {
  new vm.Script(inline[i][2], { filename: `index.html:inline-script-${i + 1}` })
}
console.log(`Sintaxe validada em ${inline.length} bloco(s) JavaScript inline.`)
