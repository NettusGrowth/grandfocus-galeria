import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const gallery = fs.readFileSync('index.html', 'utf8')
const page = fs.readFileSync('admin-importar-acessos.html', 'utf8')
assert.match(gallery, /admin-importar-acessos\.html/)
assert.match(page, /CADASTROS_NOVOS/)
assert.match(page, /\['admin','super_admin'\]/)
assert.match(page, /persistSession:false/)
assert.match(page, /responsavel_alunos/)
assert.match(page, /criar\.auth\.signUp|criador\.auth\.signUp/)
assert.match(page, /email_confirmed_at/)
assert.match(page, /AGUARDA CONFIRMAÇÃO/)
assert.match(page, /XLSX\.writeFile/)
assert.doesNotMatch(page, /SUPABASE_SERVICE_ROLE_KEY/)
const code = page.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]
assert.ok(code, 'Script da importação ausente')
new vm.Script(code, { filename:'admin-importar-acessos.html' })
const elements = new Map()
const elem = id => {
  if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:true,hidden:true,className:''})
  return elements.get(id)
}
const ctx = vm.createContext({
  window:{supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:null},error:null})}})}},
  document:{getElementById:elem},
  XLSX:{},console,confirm:()=>false
})
vm.runInContext(code,ctx)
assert.equal(vm.runInContext("norm('Cecília Garcês Neves Lanzarin')",ctx),'cecilia garces neves lanzarin')
assert.equal(vm.runInContext("coluna({'SENHA PROPOSTA — NÃO ATIVA':'forte12345678'},'senha proposta')",ctx),'forte12345678')
assert.equal(vm.runInContext("coluna({'BAILARINA(S)':'Joana Silva'},'bailarina')",ctx),'Joana Silva')
vm.runInContext("alunos=[{id:'a',nome:'Talita Borges Alves Lemos'},{id:'b',nome:'Maria Luísa Borges Alves Lemos'}]; perfis=[]",ctx)
const vinculo = vm.runInContext("idsDasAlunas({filhos:'Maria Luísa Borges Alves Lemos; Talita Borges Alves Lemos'})",ctx)
assert.deepEqual(Array.from(vinculo.ids),['b','a'],'Dois filhos, dois vínculos')
assert.equal(vinculo.erro,'')
vm.runInContext("linhas=[{nome:'Talita Borges Alves Lemos',filhos:'Maria Luísa Borges Alves Lemos; Talita Borges Alves Lemos',username:'ep.talita.lemos',senha:'SenhaInicialForte123',status:'PENDENTE',erro:''}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'PRONTO')
assert.deepEqual(Array.from(vm.runInContext('linhas[0].aluno_ids',ctx)),['b','a'])
vm.runInContext("perfis=[{username:'ep.talita.lemos',nome:'Talita Borges Alves Lemos'}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'EXISTENTE','Nunca criar conta repetida')
console.log('✓ Importação de acessos: guard admin, Excel, múltiplos filhos, duplicidade, autenticação isolada, exportação.')
