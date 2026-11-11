import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html = fs.readFileSync('index.html', 'utf8')
const start = html.indexOf('let _r2RenovacaoPendente = null')
const end = html.indexOf('\nasync function _r2SignedUrl(', start)
assert.ok(start > 0 && end > start, 'Recuperação 401 deve existir')
const source = html.slice(start,end)

function environment({responseStatuses=[200],refreshOK=true}={}) {
  const authLog=[]
  const requests=[]
  let token='jwt-original'
  let loginShown=0
  let notice={textContent:'',style:{display:'none'}}
  let refreshes=0
  let responseIndex=0
  const db={
    auth:{
      async getSession(){return {data:{session:{access_token:token}},error:null}},
      async refreshSession(){
        refreshes++
        await new Promise(resolve=>setTimeout(resolve,10))
        if(!refreshOK)return {data:{session:null},error:{message:'session_not_found'}}
        token='jwt-novo'
        return {data:{session:{access_token:token}},error:null}
      },
      async signOut(options){authLog.push(options);return {error:null}},
    },
  }
  const ctx=vm.createContext({
    db,SUPABASE_URL:'https://supabase.test',SUPABASE_ANON_KEY:'public-key',
    mostrarLogin(){loginShown++},
    document:{getElementById(id){return id==='login-error'?notice:null}},
    fetch:async(_url,opts)=>{
      requests.push(opts.headers.Authorization)
      const index=responseIndex++
      const status=responseStatuses[Math.min(index,responseStatuses.length-1)]
      return {status,ok:status>=200&&status<300,
        json:async()=>status===200?{urls:[{key:'foto.jpg',url:'signed'}]}:{error:'Sessão inválida ou expirada.'}}
    },
    console,Promise,Set,Map
  })
  vm.runInContext(source,ctx)
  return {ctx,authLog,requests,notice,loginShown:()=>loginShown,refreshes:()=>refreshes,
    call:()=>vm.runInContext("_r2Api('sign',{keys:['foto.jpg']})",ctx)}
}
{
  const e=environment({responseStatuses:[200]})
  const result=await e.call()
  assert.equal(result.urls[0].url,'signed')
  assert.equal(e.refreshes(),0)
  assert.equal(e.loginShown(),0)
}
{
  const e=environment({responseStatuses:[401,200]})
  await e.call()
  assert.equal(e.refreshes(),1)
  assert.deepEqual(e.requests,['Bearer jwt-original','Bearer jwt-novo'])
  assert.equal(e.loginShown(),0)
}
{
  // Dez requisições que falham juntas não devem iniciar dez
  // refreshes nem pedir para o usuário digitar senha dez vezes.
  const e=environment({responseStatuses:[...Array(10).fill(401),...Array(10).fill(200)]})
  await Promise.all(Array.from({length:10},()=>e.call()))
  assert.equal(e.refreshes(),1)
  assert.equal(e.loginShown(),0)
}
{
  const e=environment({responseStatuses:[401,401],refreshOK:false})
  await assert.rejects(e.call(),/sessão expirou/i)
  assert.deepEqual(JSON.parse(JSON.stringify(e.authLog)),[{scope:'local'}])
  assert.equal(e.loginShown(),1)
  assert.match(e.notice.textContent,/Entre novamente/)
  assert.equal(e.notice.style.display,'block')
  await assert.rejects(e.call(),/sessão expirou/i)
  assert.equal(e.refreshes(),1,'Não repetir refresh após sessão invalidada')
}
{
  const e=environment({responseStatuses:[403]})
  await assert.rejects(e.call(),/armazenamento|Sessão inválida/i)
  assert.equal(e.refreshes(),0,'Erro 403 não é uma sessão revogada')
  assert.equal(e.loginShown(),0)
}
assert.match(html, /if \(_event === 'SIGNED_IN'\) _r2SessaoEncerrada = false/)
assert.match(html,/scope: 'local'/)
console.log('✓ R2 401: renovação automática, 10 chamadas simultâneas, login seguro e permissões intactas.')
