import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge=fs.readFileSync('supabase/functions/r2-storage/index.ts','utf8');
const migration=fs.readFileSync('supabase/sql/074_storage_paths_visiveis_lote.sql','utf8');

// O motivo do incidente: gallery com >1.000 registros teve URLs
// assinadas negadas após buscar todos os caminhos como linhas de RPC.
// Os caminhos precisam ser verificados em lotes de até 80 como text[]
// (uma única linha na resposta JSON do PostgREST).
assert.match(edge,/rpc\('storage_paths_visiveis_lote',\s*\{\s*p_paths:\s*galleryKeys\s*\}\)/);
assert.match(edge,/new Set\(keys\.filter\(\(key: string\) => GALLERY_KEY\.test\(key\)\)\)/);
assert.doesNotMatch(edge,/rpc\('storage_paths_visiveis'\)/);
assert.match(migration,/returns text\[\]/i);
assert.match(migration,/cardinality\(p_paths\)\s*>\s*80/i);
assert.match(migration,/auth\.uid\(\) is null/i);
assert.match(migration,/join public\.fotos_visiveis\(\)/i);
assert.match(migration,/where caminho\.path = any\(p_paths\)/i);
assert.match(migration,/revoke all on function public\.storage_paths_visiveis_lote\(text\[\]\) from public, anon/i);
assert.match(migration,/grant execute on function public\.storage_paths_visiveis_lote\(text\[\]\) to authenticated/i);

// Não permitir bypass por nome válido: verificação RLS deve permanecer.
// Galeria integral já foi inventariada no R2: elimina uma chamada HEAD
// por foto e preserva as checagens para capas e outros recursos.
assert.match(edge,/await canReadObjectKey\(key, isAdmin, visiblePaths, visibleIds, activeHeroPath\)/);
assert.match(edge,/if \(!authorized\) return \{ key, url: null \}/);
assert.match(edge,/if \(GALLERY_KEY\.test\(key\)\) \{/);
assert.match(edge,/else if \(await r2ObjectExists\(key\)\)/);
assert.match(edge,/r2ObjectExists\(key\)/);
assert.match(edge,/async function canUploadObjectKey/);
assert.match(edge,/const AUXILIARY_KEY/);
console.log('✓ Assinatura R2: RPC em lote sem truncamento, ACL e recursos auxiliares preservados.');
