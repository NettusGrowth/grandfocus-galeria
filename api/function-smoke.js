export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({error:"Method not allowed"});
  const base = "https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/";
  const key = "sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0";
  async function call(name, body) {
    try {
      const r = await fetch(base + name, {method:"POST", headers:{"Content-Type":"application/json","apikey":key}, body:JSON.stringify(body)});
      const data = await r.json().catch(()=>({}));
      return {status:r.status, body:data};
    } catch { return {status:0, body:{error:"request failed"}}; }
  }
  const gallery = await call("galeria-publica", {token:"__invalid_migration_smoke_token__"});
  const selection = await call("selecao-publica", {});
  return res.status(200).json({gallery, selection});
}
