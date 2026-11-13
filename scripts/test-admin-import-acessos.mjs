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
  XLSX:{},console,confirm:()=>false,
  crypto:{getRandomValues(buffer){buffer.forEach((_,i)=>buffer[i]=(i*17+29)%256);return buffer;}}
})
vm.runInContext(code,ctx)
assert.equal(vm.runInContext("norm('Cecília Garcês Neves Lanzarin')",ctx),'cecilia garces neves lanzarin')
assert.equal(vm.runInContext("coluna({'SENHA PROPOSTA — NÃO ATIVA':'forte12345678'},'senha proposta')",ctx),'forte12345678')
assert.equal(vm.runInContext("coluna({'BAILARINA(S)':'Joana Silva'},'bailarina')",ctx),'Joana Silva')
elem('escola-select').value='7896da46-5dd8-4d4e-ac50-36fda4966566';
elem('criar-alunas').checked=true;
vm.runInContext("escolas=[{id:'7896da46-5dd8-4d4e-ac50-36fda4966566',nome:'Studio Entrepliés'}]; alunos=[{id:'a',nome:'Talita Borges Alves Lemos'},{id:'b',nome:'Maria Luísa Borges Alves Lemos'}]; perfis=[]; vinculos=[]",ctx)
const vinculo = vm.runInContext("idsDasAlunas({filhos:'Maria Luísa Borges Alves Lemos; Talita Borges Alves Lemos'})",ctx)
assert.deepEqual(Array.from(vinculo.ids),['b','a'],'Dois filhos, dois vínculos')
assert.equal(vinculo.erro,'')
vm.runInContext("linhas=[{nome:'Talita Borges Alves Lemos',filhos:'Maria Luísa Borges Alves Lemos; Talita Borges Alves Lemos',username:'ep.talita.lemos',senha:'SenhaInicialForte123',status:'PENDENTE',erro:''}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'PRONTO')
assert.deepEqual(Array.from(vm.runInContext('linhas[0].aluno_ids',ctx)),['b','a'])
vm.runInContext("perfis=[{user_id:'resp1',username:'ep.talita.lemos',nome:'Talita Borges Alves Lemos',role:'responsavel'}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'VINCULAR','Conta existente deve ganhar vínculos sem nova senha')
assert.equal(vm.runInContext('linhas[0].senha',ctx),'','Senha antiga jamais substituída')
vm.runInContext("vinculos=[{user_id:'resp1',aluno_id:'a'},{user_id:'resp1',aluno_id:'b'}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'EXISTENTE','Duplicação de conta bloqueada')

assert.equal(vm.runInContext("nomeArquivoEscola('Grand_Focus_entre-estacoes_respostas.csv')",ctx),'Studio Entrepliés')
assert.equal(vm.runInContext("nomeArquivoEscola('Grand_Focus_gente-que-danca-2026_respostas.csv')",ctx),'Gente que Dança')
assert.equal(vm.runInContext("nomeArquivoEscola('Grand_Focus_natal-fada-acucarada-2026_respostas.csv')",ctx),'Estúdio Fada Açucarada')
const sample = '\uFEFF"Data da inscrição";"Responsável";"WhatsApp";"Bailarinas";"Experiência";"Valor (R$)";"Situação do pagamento";"Anotações"\r\n'
 + '"12/11/2026";"Marta de Souza";"34999998888";"Clara de Souza";"Pacote";"79,00";"Pendente";"texto com ; ponto e vírgula"\r\n'
 + '"12/11/2026";"Marta de Souza";"34999998888";"Luísa Maria de Souza";"Outro";"159,00";"Pago";"campo ""entre aspas"""\r\n'
 + '"12/11/2026";"Joana Alves";"34977778888";"Beatriz Alves";"Palco";"79,00";"Não pago";""\r\n'
const parsed=vm.runInContext('interpretarCSV('+JSON.stringify(sample)+')',ctx)
assert.equal(parsed.length,3,'CSV oficial com BOM, aspas e ; deve ser lido')
assert.equal(parsed[0]['Anotações'],'texto com ; ponto e vírgula')
assert.equal(parsed[1]['Anotações'],'campo "entre aspas"')
assert.equal(parsed[0]['Situação do pagamento'],'Pendente')
const rows=vm.runInContext('construirLinhas('+JSON.stringify(parsed)+',"csv")',ctx)
assert.equal(rows.length,2,'Duas inscrições da mesma mãe viram um responsável')
assert.equal(rows[0].filhos,'Clara de Souza; Luísa Maria de Souza')
assert.match(rows[0].username,/^ep\.marta\.souza/)
assert.ok(rows[0].senha.length>=12)
vm.runInContext('linhas=construirLinhas(interpretarCSV('+JSON.stringify(sample)+'),"csv");perfis=[];alunos=[];vinculos=[];validarLinhas()',ctx)
assert.equal(vm.runInContext('linhas.filter(r=>r.status==="PRONTO").length',ctx),2,
  'Pagamento não limita importação, e alunos novos com nome completo são aceitos')
assert.equal(vm.runInContext('linhas[0].novas.length',ctx),2,'Dois alunos novos podem ser cadastrados')
vm.runInContext("alunos=[{id:'existing',nome:'Clara'}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'REVISAR','Nome abreviado pré-existente impede novo aluno duplicado')
vm.runInContext("alunos=[];perfis=[{user_id:'parent',nome:'Marta de Souza',role:'responsavel',telefone:'34999998888'}];validarLinhas()",ctx)
assert.equal(vm.runInContext('linhas[0].status',ctx),'VINCULAR','CSV cria vínculos sem redefinir senha')
assert.equal(vm.runInContext('linhas[0].senha',ctx),'','Senha da conta existente deve permanecer desconhecida')
const central='\uFEFF"Origem";"Identificador";"Data da resposta";"Responsável";"WhatsApp";"E-mail";"Bailarinas";"Situação financeira"\r\n"Google Forms";"1";"12/11";"Helena Dias";"34911112222";"";"Nina Dias";"Pendente"\r\n'
assert.equal(vm.runInContext('interpretarCSV('+JSON.stringify(central)+').length',ctx),1,'CSV da Central também reconhecido')
assert.throws(()=>vm.runInContext("interpretarCSV('Valor;Status\\n79;Pago')",ctx),/CSV incompatível/,
  'CSV sem nomes de responsáveis e alunos não deve gerar acesso')

console.log('✓ Importação de acessos: guard admin, Excel, múltiplos filhos, duplicidade, autenticação isolada, exportação.')
