-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Módulo Digipix: corrige RLS que faltou no
-- Passo 2 (portal do cliente). Rodar depois de 001 a 075. Aditiva.
--
-- Achado numa bateria de testes que revisou o módulo inteiro com
-- ceticismo: 074_digipix_editor.sql só criou UMA policy pra
-- album_templates (album_templates_admin_all, só admin/super_admin).
-- 075_digipix_portal_cliente.sql liberou SELECT pro cliente em
-- album_projects/spreads/elements, mas esqueceu album_templates.
--
-- O portal do cliente (iniciarAlbumCliente, index.html) busca o
-- template via embed:
--   db.from('album_projects').select('*, album_templates(*)')...
-- PostgREST/RLS filtra o recurso embutido pela policy da TABELA
-- embutida, não da tabela principal — sem essa policy nova, o embed
-- sempre volta `album_templates: null` pro responsável de verdade
-- (mesmo a linha de album_projects sendo visível pra ele). Resultado:
-- _albumClienteTemplate nunca populava, e toda a matemática de
-- posição da lâmina (%→mm, largura/altura) quebrava com TypeError na
-- tela do cliente — não pegou nos testes desta sessão inteira porque
-- eles sempre usam `db.from` mockado, que não passa pela RLS real.
-- Efeito prático: o portal "Meu Álbum" (Passo 2) pode ter estado
-- quebrado pra qualquer responsável de verdade desde que foi
-- publicado, sem ninguém perceber ainda.
-- ════════════════════════════════════════════════════════════════

create policy album_templates_cliente_select on album_templates for select to authenticated
  using (
    id in (select album_template_id from album_projects where cliente_user_id = auth.uid())
  );
