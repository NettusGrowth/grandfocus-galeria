import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const base='contratar/fada-natal/';
const html=read(base+'index.html');
const css=read(base+'fada.css');
const js=read(base+'fada.js');
const routes=JSON.parse(read('vercel.json')).rewrites;
const names=[
 '/contratar/natal-fada-acucarada-2026',
 '/contratar/natal-fada-acucarada-2026/',
 '/contratar/jardim-encantado-fada-acucarada-2026',
 '/contratar/jardim-encantado-fada-acucarada-2026/'
];
// WhatsApp / Facebook and social-share metadata must describe the current edition.
const canonical='https://galeria.grandfocus.com.br/contratar/jardim-encantado-fada-acucarada-2026/';
for(const [property, expected] of [
 ['og:type', 'website'],
 ['og:site_name', 'Grand Focus Fotografia'],
 ['og:title', 'Jardim Encantado 2026 | Grand Focus × Fada Açucarada'],
 ['og:url', canonical],
 ['og:image', 'https://galeria.grandfocus.com.br/assets/logo-icone.png?v=20261123-jardim']
]){
 const tag='<meta property="'+property+'" content="'+expected+'">';
 assert.ok(html.includes(tag), 'Social sharing meta missing or altered: '+property);
 assert.equal(html.split('property="'+property+'"').length-1,1,'Duplicate social tag: '+property);
}
assert.ok(html.includes('<link rel="canonical" href="'+canonical+'">'),'Canonical URL missing');
assert.ok(html.includes('property="og:description" content="Uma experiência especial de fotografia de dança em Ibaté'),'WhatsApp description missing');
assert.ok(html.includes('name="twitter:card" content="summary"'),'Twitter card missing');
assert.ok(fs.existsSync('dist/assets/logo-icone.png'),'Social share brand image is not available in deployment');
assert.ok(!html.slice(0,html.indexOf('</head>')).includes('Ensaio de Natal'),'Stale Christmas preview in metadata');
const fallback=routes.findIndex(x=>x.source==='/contratar/:slug');
for(const name of names){
 const i=routes.findIndex(x=>x.source===name);
 assert.ok(i>=0&&i<fallback,name+' must have an explicit route before the generic fallback');
 assert.equal(routes[i].destination,'/contratar/fada-natal/index.html');
}
for(const phrase of [
 'Jardim Encantado 2026',
 'Onde a magia da dança floresce.',
 'MEMÓRIAS QUE FLORESCEM',
 'Edição especial de dança',
 'Nesta experiência, serão utilizados os figurinos do espetáculo, que os bailarinos receberão da Escola Fada Açucarada.',
 'Acesso vitalício à galeria.',
 '10 fotografias digitais tratadas por aluno',
 'As fotografias em família fazem parte das 10 imagens por aluno, não são 10 fotografias adicionais.',
 'Até 10 dias'
]){
 if(phrase==='Até 10 dias'){
  assert.ok(/em até 10 dias corridos/i.test(html),'10-day delivery missing');
 }else assert.ok(html.includes(phrase),'Missing approved copy: '+phrase);
}
for(const old of ['Memórias de Natal','cenário natalino','Edição especial de Natal','Especial de Natal']){
 assert.ok(!html.includes(old),'Retired Christmas sales copy reintroduced: '+old);
}
for(const preserved of [
 'id="gf-fada-form"',
 'id="gf-students"',
 'id="gf-slots"',
 'id="gf-recap"',
 'id="gf-submit"',
 'id="gf-consent"',
 'id="gf-whatsapp"',
 'id="gf-success"',
 'id="gf-payment-preference"',
 'data-day="2026-12-12"',
 'data-day="2026-12-13"',
 'name="pagamento"',
 'value="ja_paguei"',
 'value="a_pagar"'
])assert.ok(html.includes(preserved),'Existing form component lost: '+preserved);

for(const [value,label] of [
 ['R$ 80,00','1 student'],
 ['R$ 145,00','2 students'],
 ['R$ 215,00','3 students'],
 ['R$ 285,00','4 students'],
 ['15 minutos','1 interval'],
 ['30 minutos consecutivos','2 intervals'],
 ['45 minutos consecutivos','3 intervals'],
 ['60 minutos consecutivos','4 intervals']
])assert.ok(html.includes(value),'Pricing or duration changed: '+label);

assert.ok(js.includes("const SLUG='natal-fada-acucarada-2026'"),'Existing booking slug must never change');
assert.ok(js.includes('1:8000,2:14500,3:21500,4:28500'),'Existing prices must never change');
assert.ok(js.includes("natal_inscrever")&&js.includes("natal_horarios"),'Existing booking actions missing');
assert.ok(!js.includes("action:'contratar'"),'No payment checkout in public form');
assert.ok(html.includes('class="gf-jardim-edition"'),'Page-scoped Garden design missing');
assert.ok(css.includes('.gf-jardim-edition .gf-hero'),'Garden style missing');
assert.ok(html.includes('gf-garden-illustration'),'Garden illustration missing');
assert.ok(!html.includes('<img src="data:image/'),'Do not present generated scenery photos as real');

const terms=read(base+'termos-jardim-encantado-v2.html');
const privacy=read(base+'privacidade-jardim-encantado.html');
for(const f of ['termos','privacidade']){
 const p=base+f+'-jardim-encantado'+(f==='termos'?'-v2':'')+'.html';
 assert.ok(html.includes('href="/'+p+'"'),'New legal document must be linked: '+f);
 assert.ok(fs.existsSync('dist/'+p),'New legal document missing from deployment: '+f);
 assert.ok(fs.existsSync(base+f+'.html'),'Legacy legal agreement must remain untouched: '+f);
}
assert.ok(terms.includes('2026-11-23-jardim-v2'),'New terms version missing');
assert.ok(terms.includes('sem exigência de novo cadastro ou novo pagamento'),'Prior family rights not stated');
assert.ok(terms.includes('R$ 285,00')&&terms.includes('10 dias corridos'),'New terms altered prices or deadline');
assert.ok(privacy.includes('Crianças e adolescentes')&&privacy.includes('Seus direitos'),'Privacy protections missing');
assert.ok(privacy.includes('acesso às fotografias da sessão pela Galeria Grand Focus é vitalício'),'Gallery access clause missing');

for(const file of ['index.html','fada.css','fada.js']){
 assert.ok(fs.existsSync('dist/'+base+file),'Expected file missing from dist: '+file);
}
const built=read('dist/'+base+'index.html');
assert.equal(built,html,'Deployment HTML differs from validated source');
assert.equal(read('dist/'+base+'fada.js'),js,'Booking logic changed during the build');
console.log('PASS Jardim Encantado: routes share same form, protected prices and booking logic, historic terms retained, legal links and design validated.');
