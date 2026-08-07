-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 6: IP no aceite de LGPD, mural do
-- professor segmentado por turma. Rodar depois de 001 a 021. Aditiva.
-- ════════════════════════════════════════════════════════════════

-- registro de aceite de LGPD ganha o IP de quem aceitou (além da data,
-- que já existia desde o Estágio E) — o IP é obtido no navegador via
-- um serviço público (ipify) antes de chamar essa função, porque uma
-- função SQL não tem acesso ao IP de quem chamou via PostgREST.
alter table perfis add column if not exists lgpd_ip text;

create or replace function aceitar_lgpd(p_ip text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update perfis set lgpd_aceito_em = now(), lgpd_ip = p_ip where user_id = auth.uid()
$$;
grant execute on function aceitar_lgpd(text) to authenticated;

-- mural do professor: tag de "pra qual turma é esse post" — cosmética,
-- só filtra visualmente o feed dentro da MESMA escola (a segurança de
-- verdade continua sendo por escola via posts_visiveis(), não por
-- turma — não existe uma tabela de "professor atribuído à turma X",
-- turma continua sendo o campo de texto livre que já existe em
-- alunos.turma desde o Bloco 3).
alter table posts add column if not exists turma text;

-- ── revisão de RLS (Bloco 6): achado real ──────────────────────────
-- o Bloco 3 (018) deu suporte a "professor em mais de uma escola" via
-- professor_escolas, e atualizou eventos_visiveis()/fotos_visiveis()
-- (que passaram a usar escolas_visiveis(), já ciente da tabela nova) —
-- só que as policies de SELECT de "escolas" e "alunos" nunca foram
-- recriadas pra acompanhar: elas ainda comparam direto contra
-- meu_perfil().escola_id (a escola PRINCIPAL), ignorando
-- professor_escolas por completo. Resultado na prática: um professor
-- vinculado a uma segunda escola conseguia ver os eventos e fotos dela,
-- mas não o nome/capa da escola nem a lista de alunos — psicose de
-- dado incompleto, não exposição indevida, mas ainda um bug real.
--
-- Importante NÃO usar alunos_visiveis()/escolas_visiveis() direto
-- aqui: essas funções incluem, de propósito, a escola do FILHO de um
-- responsável (pra ele ver fotos/eventos gerais daquela escola) — se
-- essa mesma regra vazasse pra cá, qualquer responsável passaria a
-- enxergar a lista COMPLETA de alunos da escola do filho, não só o
-- próprio filho. Por isso o predicado abaixo é escrito à mão, só com
-- o lado "equipe" (perfil principal + professor_escolas), mantendo o
-- responsável restrito a meus_alunos() como sempre foi.
drop policy if exists escolas_select_own on escolas;
create policy escolas_select_own on escolas for select to authenticated
using (
  id in (
    select escola_id from perfis where user_id = auth.uid() and escola_id is not null
    union
    select escola_id from professor_escolas where user_id = auth.uid()
  )
);

drop policy if exists alunos_select on alunos;
create policy alunos_select on alunos for select to authenticated
using (
  escola_id in (
    select escola_id from perfis where user_id = auth.uid() and escola_id is not null
    union
    select escola_id from professor_escolas where user_id = auth.uid()
  )
  or id in (select aluno_id from meus_alunos())
);

-- ── aba Equipe pro professor (Bloco 6) ─────────────────────────────
-- até aqui só proprietário/diretor enxergavam colegas via select em
-- "perfis" (014_equipe_escola.sql) — o professor via só a própria
-- linha. Libera professor ver os OUTROS professores/diretores da
-- MESMA escola (só leitura, só colegas de equipe — de propósito NÃO
-- libera ver a lista de responsáveis/pais pra um professor, isso
-- continua exclusivo de quem já podia antes). resetar_senha() já
-- rejeita professor no banco desde o Estágio A, então nem precisa
-- esconder nada além da lista em si.
drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select to authenticated
using (
  user_id = auth.uid()
  or (select role from meu_perfil()) in ('admin','super_admin')
  or (
    (select role from meu_perfil()) in ('proprietario','diretor')
    and (
      (role in ('proprietario','diretor','professor') and escola_id = (select escola_id from meu_perfil()))
      or (role = 'responsavel' and user_id in (
        select ra.user_id from responsavel_alunos ra
        join alunos al on al.id = ra.aluno_id
        where al.escola_id = (select escola_id from meu_perfil())
      ))
    )
  )
  or (
    (select role from meu_perfil()) = 'professor'
    and role in ('proprietario','diretor','professor')
    and escola_id = (select escola_id from meu_perfil())
  )
);

-- ── upload de fotos pela equipe da escola (Bloco 6) ────────────────
-- até aqui só o admin conseguia escrever em fotos/foto_aluno/storage —
-- nem o dono da escola conseguia subir a própria foto de evento. O
-- atalho "Fazer Upload" no card de evento do professor pede essa
-- permissão; perguntei o alcance e a decisão foi liberar pra toda a
-- equipe da escola (escola/proprietário/diretor/professor), não só
-- professor — sempre restrito às escolas que a pessoa já enxerga
-- (escolas_visiveis()/eventos_visiveis(), que já contempla
-- professor_escolas). Apagar continua exclusivo do admin — não foi
-- pedido pra equipe da escola, então não abre essa porta.
drop policy if exists fotos_escola_insert on fotos;
create policy fotos_escola_insert on fotos for insert to authenticated
with check (
  (select role from meu_perfil()) in ('escola','proprietario','diretor','professor')
  and evento_id in (select eventos_visiveis())
);

drop policy if exists foto_aluno_escola_insert on foto_aluno;
create policy foto_aluno_escola_insert on foto_aluno for insert to authenticated
with check (
  (select role from meu_perfil()) in ('escola','proprietario','diretor','professor')
  and foto_id in (select fotos_visiveis())
);
grant insert on fotos, foto_aluno to authenticated;

drop policy if exists fotos_storage_escola_insert on storage.objects;
create policy fotos_storage_escola_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'fotos-grandfocus'
  and (select role from meu_perfil()) in ('escola','proprietario','diretor','professor')
  and split_part(name,'/',1) ~ '^[0-9a-fA-F-]{36}$'
  and split_part(name,'/',1)::uuid in (select eventos_visiveis())
);
