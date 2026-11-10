-- Fixture temporária: garante fornecedor Grand Focus já cadastrado, apenas no CI.
set role service_role;
select public.gf_contratacao_admin_criar_campanha(
 'Natal fornecedor de teste',date '2026-12-12',
 '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid,
 'natal-fada-acucarada-2026',
 '11111111-1111-4111-8111-111111111111'::uuid);
update public.gf_contratacao_eventos
 set fornecedor_nome='Grand Focus Teste',
     fornecedor_documento='69691249000197',
     fornecedor_email='teste@example.com',
     whatsapp_atendimento='34992632922'
 where slug='natal-fada-acucarada-2026';
