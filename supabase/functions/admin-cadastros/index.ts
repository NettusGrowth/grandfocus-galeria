import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Apenas admins autenticados conseguem criar contas. Nenhuma chave de serviço
// vai ao navegador; o papel do solicitante é consultado no banco a cada pedido.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9._-]{3,32}$/;
type Cadastro = {
  nome: string; username: string; senha: string; telefone?: string;
  email?: string; escola_id: string; aluno_ids: string[];
};
function validar(raw: unknown): Cadastro {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Dados do cadastro inválidos.");
  const x = raw as Record<string, unknown>;
  const nome = String(x.nome ?? "").trim().replace(/\s+/g, " ");
  const username = String(x.username ?? "").trim().toLowerCase();
  const senha = String(x.senha ?? "");
  const telefone = String(x.telefone ?? "").replace(/\D/g, "").slice(0, 20);
  const email = String(x.email ?? "").trim().toLowerCase();
  const escola_id = String(x.escola_id ?? "").trim();
  const aluno_ids = Array.isArray(x.aluno_ids) ? x.aluno_ids.map(String) : [];
  if (nome.length < 4 || nome.length > 180 || /[%_<>]/.test(nome)) throw new Error("Nome do responsável inválido.");
  if (!USERNAME.test(username)) throw new Error("Usuário inválido: use 3 a 32 letras, números, pontos ou traços.");
  if (senha.length < 12 || senha.length > 100) throw new Error("Senha inicial deve ter entre 12 e 100 caracteres.");
  if (!UUID.test(escola_id)) throw new Error("Selecione uma escola válida.");
  if (!aluno_ids.length || aluno_ids.length > 12 || aluno_ids.some(id => !UUID.test(id)) ||
      new Set(aluno_ids).size !== aluno_ids.length) throw new Error("Escolha de 1 a 12 alunos diferentes.");
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254))
    throw new Error("E-mail de contato inválido.");
  return { nome, username, senha, telefone, email, escola_id, aluno_ids };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Faça login como administrador." }, 401);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return json({ error: "Serviço administrativo indisponível." }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);
    const { data: perfil, error: perfilError } = await admin.from("perfis")
      .select("role,nome").eq("user_id", user.id).maybeSingle();
    if (perfilError || !["admin", "super_admin"].includes(perfil?.role || ""))
      return json({ error: "Apenas administradores da Grand Focus podem criar acessos." }, 403);
    const body = await req.json().catch(() => null);
    if (body?.action === "status") return json({ ok: true, autorizado: true, tipo: perfil.role });
    if (body?.action !== "criar") return json({ error: "Ação não reconhecida." }, 400);
    const c = validar(body?.cadastro);
    const loginEmail = c.username + "@login.grandfocus.internal";
    const { data: escola, error: escolaErr } = await admin.from("escolas").select("id")
      .eq("id", c.escola_id).maybeSingle();
    if (escolaErr || !escola) return json({ error: "Escola não encontrada." }, 422);
    const { data: alunos, error: alunosErr } = await admin.from("alunos")
      .select("id,escola_id").in("id", c.aluno_ids);
    if (alunosErr || !alunos || alunos.length !== c.aluno_ids.length ||
        alunos.some(a => a.escola_id !== c.escola_id))
      return json({ error: "Um ou mais alunos não pertencem à escola escolhida. Cadastro não realizado." }, 422);

    // Duplicação conservadora: não renomeia, não redefine senhas e não cria
    // outra conta para um nome/usuário já existente. Revisar manualmente.
    const [byUsername, byName] = await Promise.all([
      admin.from("perfis").select("user_id,nome,username").eq("username", c.username).limit(1),
      admin.from("perfis").select("user_id,nome,username").ilike("nome", c.nome).limit(3),
    ]);
    if (byUsername.error || byName.error) return json({ error: "Não foi possível conferir duplicidades." }, 503);
    if ((byUsername.data || []).length || (byName.data || []).length)
      return json({ error: "Possível acesso já existente. Confira antes de criar outro.", existente: true,
        encontrados: [...(byUsername.data || []), ...(byName.data || [])].map(p => ({
          nome: p.nome, username: p.username,
        })) }, 409);

    const { data: criado, error: authCreateErr } = await admin.auth.admin.createUser({
      email: loginEmail, password: c.senha, email_confirm: true,
      user_metadata: { full_name: c.nome },
    });
    if (authCreateErr || !criado?.user?.id)
      return json({ error: "Não foi possível criar a autenticação: " + (authCreateErr?.message || "erro desconhecido") }, 409);

    const newUserId = criado.user.id;
    try {
      const { error: perfilCreateErr } = await admin.from("perfis").insert({
        user_id: newUserId, role: "responsavel", escola_id: c.escola_id,
        nome: c.nome, username: c.username, telefone: c.telefone || null, email: c.email || null,
      });
      if (perfilCreateErr) throw new Error("Falha no perfil: " + perfilCreateErr.message);
      const { error: linkErr } = await admin.from("responsavel_alunos").insert(
        c.aluno_ids.map(aluno_id => ({ user_id: newUserId, aluno_id })),
      );
      if (linkErr) throw new Error("Falha no vínculo escolar: " + linkErr.message);
    } catch (err) {
      // Retorna o sistema ao estado anterior para não deixar conta órfã.
      await admin.from("responsavel_alunos").delete().eq("user_id", newUserId);
      await admin.from("perfis").delete().eq("user_id", newUserId);
      const { error: cleanupErr } = await admin.auth.admin.deleteUser(newUserId);
      if (cleanupErr) console.error("admin-cadastros: limpeza pendente", newUserId, cleanupErr.message);
      return json({ error: "Cadastro não concluído. " + (err instanceof Error ? err.message : "Erro de gravação."),
        limpeza_pendente: !!cleanupErr }, 500);
    }
    // Nunca registra senhas, nem no perfil, nem em auditoria/logs.
    await admin.from("auditoria").insert({
      user_id: user.id, user_nome: perfil?.nome || "Admin",
      acao: "criou responsável por importação segura", tabela: "perfis",
      registro_id: newUserId, detalhe: "usuário " + c.username + "; alunos vinculados: " + c.aluno_ids.length,
    });
    return json({ ok: true, status: "criado", user_id: newUserId, username: c.username,
      aluno_ids: c.aluno_ids, escola_id: c.escola_id }, 201);
  } catch (err) {
    console.error("admin-cadastros:", err instanceof Error ? err.message : "erro");
    return json({ error: err instanceof Error ? err.message : "Não foi possível concluir a operação." }, 400);
  }
});
