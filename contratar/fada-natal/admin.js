// Agenda administrativa da campanha Fada Açucarada. Reusa Supabase Auth da galeria.
const SLUG='natal-fada-acucarada-2026'
const current=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'')
const host=document.getElementById('gf-natal-schedule')
if(current!==SLUG){
  host?.remove()
}else if(host){
  const apiUrl='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-admin'
  const supaUrl='https://selnsjtumkxjrtnqofqx.supabase.co'
  const key='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
  const $=id=>document.getElementById(id)
  let loading=false
  let supa=null
  async function request(action,params={}){
    if(!supa){
      const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2')
      supa=createClient(supaUrl,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}})
    }
    const {data}=await supa.auth.getSession()
    const token=data?.session?.access_token
    if(!token)throw new Error('Sua sessão expirou. Faça login novamente.')
    const response=await fetch(apiUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+token},
      body:JSON.stringify({action,slug:SLUG,...params}),
      signal:AbortSignal.timeout(15000)
    })
    const result=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(result.error||'Não foi possível atualizar a agenda.')
    return result
  }
  function message(text,error=false){
    $('gf-natal-notice').textContent=text
    $('gf-natal-notice').dataset.error=String(error)
  }
  function el(tag,className,text){
    const e=document.createElement(tag)
    if(className)e.className=className
    if(text!==undefined)e.textContent=text
    return e
  }
  function render(data){
    const root=$('gf-natal-slots-admin');root.replaceChildren()
    const list=Array.isArray(data.horarios)?data.horarios:[]
    if(!list.length){
      root.append(el('p','gf-natal-empty','Nenhum horário cadastrado. Defina acima o início, o fim e a duração das sessões dos dias 12 e 13.'))
      return
    }
    for(const day of ['2026-12-12','2026-12-13']){
      const slots=list.filter(x=>x.dia===day)
      if(!slots.length)continue
      const box=el('section','gf-natal-day-group')
      box.append(el('h3','',day==='2026-12-12'?'Sábado, 12 de dezembro':'Domingo, 13 de dezembro'))
      const area=el('div','gf-natal-chip-list')
      for(const slot of slots){
        const remaining=Number(slot.disponiveis)||0
        const chip=el('div','gf-natal-chip')
        chip.dataset.full=String(remaining===0)
        chip.dataset.disabled=String(!slot.ativo)
        chip.append(el('strong','',slot.inicio),el('small','',!slot.ativo?'Desativado':remaining?'Livre':'Ocupado'))
        if(slot.ativo&&Number(slot.ocupados)===0){
          const off=el('button','','Desativar')
          off.type='button'
          off.setAttribute('aria-label','Desativar horário '+slot.inicio+' de '+day)
          off.addEventListener('click',async()=>{
            if(!confirm('Desativar '+slot.inicio+' em '+day.split('-').reverse().join('/')+'? Uma vaga existente não será afetada.'))return
            off.disabled=true
            try{
              await request('natal_desativar_horario',{horario_id:slot.id})
              message('Horário desativado.')
              await refresh(false)
            }catch(error){message(error.message||'Não foi possível desativar.',true);off.disabled=false}
          })
          chip.append(off)
        }
        area.append(chip)
      }
      box.append(area);root.append(box)
    }
  }
  async function refresh(reportErrors=true){
    if(loading)return
    loading=true
    try{
      const data=await request('natal_agenda')
      render(data)
    }catch(error){
      if(reportErrors)message(error.message||'Falha ao consultar agenda.',true)
    }finally{loading=false}
  }
  $('gf-natal-build').addEventListener('submit',async event=>{
    event.preventDefault()
    const dia=$('gf-natal-date').value
    const inicio=$('gf-natal-start').value
    const fim=$('gf-natal-end').value
    const duracao=Number($('gf-natal-duration').value)
    if(!inicio||!fim||inicio>=fim||!Number.isInteger(duracao)||duracao<5||duracao>90){
      message('Informe horários válidos e a duração de 5 a 90 minutos.',true);return
    }
    const button=$('gf-natal-build-button')
    button.disabled=true
    try{
      const result=await request('natal_gerar_horarios',{
        dia,inicio,fim,duracao_minutos:duracao
      })
      message('Agenda atualizada: '+result.novos+' novos horários adicionados. Nenhum pagamento foi processado.')
      await refresh(false)
    }catch(error){message(error.message||'Não foi possível criar os horários.',true)}
    finally{button.disabled=false}
  })
  $('gf-natal-refresh').addEventListener('click',()=>refresh())
  window.addEventListener('gf-contratacao-admin-ready',()=>{void refresh()})
  if(!document.getElementById('admin-area')?.classList.contains('hidden'))void refresh()
}
