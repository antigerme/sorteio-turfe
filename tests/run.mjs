#!/usr/bin/env node
/* Suíte de testes do Sorteio (Turfe) — SEM dependências, sem navegador.
 *
 * Carrega o index.html REAL num contexto `vm` (com stubs mínimos de DOM) e
 * exercita o código que de fato é servido. Cobre os dois contratos do produto:
 *
 *   1) DETERMINISMO — `App.Sim.simulate(seed, n)` é puro e reprodutível, e a
 *      ordem de chegada (o "sorteio justo") está travada por um golden hash.
 *   2) QR CODE — `App.QR.make` gera QR válido: format info nas posições da ISO
 *      (regressão do bug de transposição), estrutura correta e round-trip
 *      (um decodificador independente, reescrito do zero pela ISO, recupera o texto).
 *
 * Uso:
 *   node tests/run.mjs            # roda tudo (falha com exit≠0)
 *   node tests/run.mjs --update   # regenera o golden do determinismo (após mudança intencional na simulação)
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'tests', 'golden-sim.json');
const UPDATE = process.argv.includes('--update');

let failures = 0;
const ok = (name, cond, extra) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failures++; };
const section = (t) => console.log(`\n${t}`);

/* ----------------------------------------------------------------------------
 * Carrega o App do index.html num vm, com stubs de DOM suficientes p/ o boot.
 * -------------------------------------------------------------------------- */
function loadApp() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).reduce((a, c) => c.length > a.length ? c : a, '');
  if (!code) throw new Error('não achei o <script> do app no index.html');

  const noop = () => {};
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, appendChild: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop, getContext: () => null, remove: noop, click: noop, focus: noop, querySelector: () => null, querySelectorAll: () => [], textContent: '', innerHTML: '', value: '', width: 0, height: 0 });
  const documentStub = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => el(), createElementNS: () => el(), addEventListener: noop, removeEventListener: noop, body: el(), head: el(), documentElement: el() };

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URLSearchParams, TextEncoder, TextDecoder, performance,
    document: documentStub,
    navigator: { clipboard: { writeText: () => Promise.resolve() }, language: 'pt-BR', userAgent: 'node' },
    // ?log=silent: silencia o logger do app durante os testes (lido no boot do App.Log).
    location: { href: 'http://localhost/', search: '?log=silent', hash: '', pathname: '/' },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop }),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: noop,
    addEventListener: noop, removeEventListener: noop,
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const _ls = new Map(); // stub de localStorage p/ exercitar App.Store
  sandbox.localStorage = { getItem: k => _ls.has(String(k)) ? _ls.get(String(k)) : null, setItem: (k, v) => { _ls.set(String(k), String(v)); }, removeItem: k => { _ls.delete(String(k)); }, clear: () => _ls.clear(), key: i => [..._ls.keys()][i] ?? null, get length() { return _ls.size; } };
  if (typeof CompressionStream !== 'undefined') sandbox.CompressionStream = CompressionStream;
  if (typeof DecompressionStream !== 'undefined') sandbox.DecompressionStream = DecompressionStream;

  const ctx = vm.createContext(sandbox);
  // O boot roda App.UI.init() (envolto em try/catch no próprio app); a linha extra
  // expõe o App mesmo que algum render toque em DOM ausente.
  vm.runInContext(code + '\n;globalThis.__APP__ = (typeof App !== "undefined") ? App : null;', ctx, { filename: 'index.html' });
  if (!sandbox.__APP__) throw new Error('App não foi exposto após carregar o index.html');
  return sandbox.__APP__;
}

/* ----------------------------------------------------------------------------
 * 0) Sintaxe do <script>
 * -------------------------------------------------------------------------- */
function testSyntax() {
  section('Sintaxe');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).reduce((a, c) => c.length > a.length ? c : a, '');
  let good = true; try { new vm.Script(code, { filename: 'index.html' }); } catch (e) { good = false; console.log('    ' + e.message); }
  ok('o <script> do index.html compila', good);
}

/* ----------------------------------------------------------------------------
 * 1) Determinismo da simulação (o "sorteio justo")
 * -------------------------------------------------------------------------- */
const GRID_SEEDS = (() => { const s = []; for (let i = 1; i <= 60; i++) s.push(i); return s.concat([0, 7, 42, 999999, 123456789, 2718281828, 4294967295]); })();
const GRID_NS = [2, 3, 4, 5, 8, 13, 21, 34, 55, 100];

// Projeta o resultado nos campos íntegros (inteiros/strings) — portável entre plataformas.
const project = (r) => ({ order: r.order, events: r.events, gain: r.gain, surges: r.surges, leadChanges: r.leadChanges, close: r.close, totalSteps: r.totalSteps });
function simFingerprint(App) {
  const rows = [];
  for (const seed of GRID_SEEDS) for (const n of GRID_NS) rows.push(project(App.Sim.simulate(seed, n)));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function testDeterminism(App) {
  section('Determinismo (sorteio justo)');

  // (a) reprodutível: mesma (seed,n) => resultado idêntico (inclui frames/mud — pega Math.random/Date)
  let repro = true;
  for (const seed of [1, 2, 7, 42, 100, 123456789]) for (const n of [3, 8, 21, 100]) {
    const a = JSON.stringify(App.Sim.simulate(seed, n)), b = JSON.stringify(App.Sim.simulate(seed, n));
    if (a !== b) { repro = false; break; }
  }
  ok('simulate(seed,n) é reprodutível (idêntico ao repetir)', repro);

  // (b) sensível à semente: sementes diferentes não dão todas a mesma ordem
  const o = new Set([1, 2, 3, 4, 5].map(s => App.Sim.simulate(s, 8).order.join(',')));
  ok('sementes diferentes produzem ordens diferentes', o.size > 1, o.size + '/5 ordens distintas');

  // (c) RNG mulberry32 reprodutível e shuffle determinístico (base do sorteio)
  const r1 = App.RNG.mulberry32(12345), r2 = App.RNG.mulberry32(12345);
  let rngOk = true; for (let i = 0; i < 1000; i++) if (r1() !== r2()) { rngOk = false; break; }
  const sh = App.RNG.mulberry32(777); const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s1 = App.RNG.shuffle(arr, App.RNG.mulberry32(9)), s2 = App.RNG.shuffle(arr, App.RNG.mulberry32(9));
  ok('RNG (mulberry32 + shuffle) determinístico', rngOk && JSON.stringify(s1) === JSON.stringify(s2) && JSON.stringify(arr) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]));

  // (d) golden: a ordem de chegada (+ eventos) está travada — qualquer mudança de resultado falha aqui
  const fp = simFingerprint(App);
  if (UPDATE) {
    fs.writeFileSync(GOLDEN, JSON.stringify({ algo: 'sha256', seeds: GRID_SEEDS, ns: GRID_NS, hash: fp }, null, 2) + '\n');
    ok('golden regenerado (--update)', true, fp.slice(0, 16) + '…');
  } else if (!fs.existsSync(GOLDEN)) {
    ok('golden existe (rode com --update p/ criar)', false);
  } else {
    const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const same = g.hash === fp;
    ok('resultado bate com o golden (' + GRID_SEEDS.length + '×' + GRID_NS.length + ' simulações)', same, same ? fp.slice(0, 16) + '…' : 'esperado ' + g.hash.slice(0, 12) + '… obtido ' + fp.slice(0, 12) + '… (se a mudança na simulação foi intencional: node tests/run.mjs --update)');
  }
}

/* ----------------------------------------------------------------------------
 * 2) QR Code — decodificador independente (reescrito pela ISO/IEC 18004)
 * -------------------------------------------------------------------------- */
const QR_ALIGN = [[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];
const QR_ECL = [null,[7,1],[10,1],[15,1],[20,1],[26,1],[18,2],[20,2],[24,2],[30,2],[18,4],[20,4],[24,4],[26,4],[30,4],[22,6],[24,6],[28,6],[30,6],[28,7],[28,8],[28,8],[28,9],[30,9],[30,10],[26,12],[28,12],[30,12],[30,13],[30,14],[30,15],[30,16],[30,17],[30,18],[30,19],[30,19],[30,20],[30,21],[30,22],[30,24],[30,25]];
const QR_FMT_L = ['111011111000100','111001011110011','111110110101010','111100010011101','110011000101111','110001100011000','110110001000001','110100101110110'];
const qsz = v => 17 + 4 * v;
function qReserved(v) {
  const n = qsz(v), R = Array.from({ length: n }, () => new Array(n).fill(false)), set = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n) R[r][c] = true; };
  for (const [pr, pc] of [[0, 0], [0, n - 7], [n - 7, 0]]) for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) set(pr + r, pc + c);
  for (let i = 0; i < n; i++) { set(6, i); set(i, 6); }
  const a = QR_ALIGN[v];
  for (const r of a) for (const c of a) { if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc); }
  for (let i = 0; i < 9; i++) { set(8, i); set(i, 8); }
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i); set(n - 1 - i, 8); }
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, n - 11 + j); set(n - 11 + j, i); }
  return R;
}
function qDataPos(v) { const n = qsz(v), R = qReserved(v), pos = []; let up = true; for (let col = n - 1; col > 0; col -= 2) { if (col === 6) col--; for (let i = 0; i < n; i++) { const row = up ? n - 1 - i : i; for (let cc = 0; cc < 2; cc++) { const c = col - cc; if (!R[row][c]) pos.push([row, c]); } } up = !up; } return pos; }
function qMask(m, r, c) { switch (m) { case 0: return (r + c) % 2 === 0; case 1: return r % 2 === 0; case 2: return c % 3 === 0; case 3: return (r + c) % 3 === 0; case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; case 5: return ((r * c) % 2 + (r * c) % 3) === 0; case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0; case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0; } }
function qTotalCw(v) { const R = qReserved(v), n = qsz(v); let free = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!R[r][c]) free++; return Math.floor(free / 8); }
// Lê o format info (15 bits) numa das duas cópias, nas posições exatas da ISO.
function qReadFormat(modules, copy) {
  const n = modules.length, g = (r, c) => modules[r][c] ? 1 : 0; let f = 0; const set = (i, b) => { f |= (b << i); };
  if (copy === 1) { for (let i = 0; i <= 5; i++) set(i, g(i, 8)); set(6, g(7, 8)); set(7, g(8, 8)); set(8, g(8, 7)); for (let i = 9; i < 15; i++) set(i, g(8, 14 - i)); }
  else { for (let i = 0; i < 8; i++) set(i, g(8, n - 1 - i)); for (let i = 8; i < 15; i++) set(i, g(n - 15 + i, 8)); }
  let s = ''; for (let i = 14; i >= 0; i--) s += (f >> i) & 1; return s;
}
// Decodifica o texto a partir da matriz (un-mask + zigzag + de-interleave + parse).
function qrDecode(q) {
  const v = q.version, pos = qDataPos(v), bits = [];
  for (const [r, c] of pos) { let b = q.modules[r][c] ? 1 : 0; if (qMask(q.mask, r, c)) b ^= 1; bits.push(b); }
  const total = qTotalCw(v), cws = [];
  for (let i = 0; i < total; i++) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | (bits[i * 8 + j] || 0); cws.push(x); }
  // de-interleave -> codewords de dados na ordem dos blocos
  const [ecLen, nb] = QR_ECL[v], dataCount = total - ecLen * nb, short = Math.floor(dataCount / nb), longCount = dataCount % nb, shortCount = nb - longCount;
  const lens = []; for (let i = 0; i < nb; i++) lens.push(short + (i >= shortCount ? 1 : 0));
  const blocks = lens.map(() => []); let idx = 0; const maxD = Math.max(...lens);
  for (let i = 0; i < maxD; i++) for (let b = 0; b < nb; b++) if (i < lens[b]) blocks[b].push(cws[idx++]);
  const data = []; for (const b of blocks) for (const x of b) data.push(x);
  // parse byte-mode
  const db = []; for (const cw of data) for (let i = 7; i >= 0; i--) db.push((cw >> i) & 1);
  let p = 0; const rd = k => { let x = 0; for (let i = 0; i < k; i++) x = (x << 1) | db[p++]; return x; };
  rd(4); const len = rd(v <= 9 ? 8 : 16), out = []; for (let i = 0; i < len; i++) out.push(rd(8));
  return new TextDecoder().decode(Uint8Array.from(out));
}
// Confere os 3 finder patterns (7x7) nos cantos.
function qFindersOk(modules) {
  const n = modules.length, F = [[1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1]];
  const at = (br, bc) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if ((modules[br + r][bc + c] ? 1 : 0) !== F[r][c]) return false; return true; };
  return at(0, 0) && at(0, n - 7) && at(n - 7, 0);
}

function testQR(App) {
  section('QR Code');
  const inputs = [
    'x', 'HELLO WORLD', 'https://sorteio.felicio.com.br/#d=AbCd-_123',
    'José & Antônio — 50% 🏇', 'a'.repeat(40), 'b'.repeat(120), 'c'.repeat(300),
    'd'.repeat(700), 'https://sorteio.felicio.com.br/#d=' + 'Z'.repeat(900),
  ];
  const masksSeen = new Set(); let fmtOk = true, rtOk = true, structOk = true, versions = new Set();
  for (const s of inputs) {
    const q = App.QR.make(s); versions.add(q.version); masksSeen.add(q.mask);
    const c1 = qReadFormat(q.modules, 1), c2 = qReadFormat(q.modules, 2);
    if (!(c1 === c2 && QR_FMT_L[q.mask] === c1)) { fmtOk = false; console.log(`    format FALHOU len=${s.length} v${q.version} mask${q.mask}`); }
    if (q.size !== qsz(q.version) || !qFindersOk(q.modules)) structOk = false;
    if (qrDecode(q) !== s) { rtOk = false; console.log(`    round-trip FALHOU len=${s.length} v${q.version} mask${q.mask}`); }
  }
  // fuzz aleatório
  for (let t = 0; t < 200; t++) { const len = 1 + ((Math.random() * 500) | 0); let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(32 + ((Math.random() * 95) | 0)); const q = App.QR.make(s); masksSeen.add(q.mask); versions.add(q.version); if (qrDecode(q) !== s) { rtOk = false; console.log('    fuzz FALHOU len=' + len); break; } if (QR_FMT_L[q.mask] !== qReadFormat(q.modules, 1)) { fmtOk = false; break; } }

  ok('format info nas posições da ISO (cópias 1 e 2) == tabela do padrão', fmtOk);
  ok('estrutura válida (tamanho coerente + 3 finder patterns)', structOk);
  ok('round-trip: decodificador independente recupera o texto', rtOk, 'versões ' + [...versions].sort((a, b) => a - b).join(','));
  ok('todas as 8 máscaras exercidas e válidas', masksSeen.size === 8, [...masksSeen].sort().join(','));
  // limite: texto grande demais deve lançar (não gerar QR inválido)
  let threw = false; try { App.QR.make('Q'.repeat(4000)); } catch (e) { threw = true; }
  ok('texto além da capacidade (v40) lança erro', threw);
}

/* ----------------------------------------------------------------------------
 * 3) Persistência local (App.Store) — round-trip salvar/restaurar
 * -------------------------------------------------------------------------- */
function testPersistence(App) {
  section('Persistência local (localStorage)');
  if (!App.Store) { ok('App.Store existe', false); return; }
  App.Store.arm(); // idempotente (o boot já arma); garante auto-save ligado
  const S = App.State;
  S.participantes = ['Ana', 'Bruno', 'Carla'];
  S.teams = ['Verde', 'Azul']; S.teamColors = { Verde: '#0a0', Azul: '#00a' };
  S.teamOf = { Ana: 'Verde', Bruno: 'Azul', Carla: 'Verde' }; S.mode = 'teams';
  App.Store.save();
  // zera o estado em memória (simula recarregar a página)
  S.participantes = []; S.teams = []; S.teamColors = {}; S.teamOf = {}; S.mode = 'single';
  const restored = App.Store.restore();
  ok('restore() devolve true quando há rascunho salvo', restored === true);
  ok('participantes restaurados', JSON.stringify(S.participantes) === JSON.stringify(['Ana', 'Bruno', 'Carla']));
  ok('equipes + atribuições + modo restaurados', S.teams.length === 2 && S.teamOf.Ana === 'Verde' && S.mode === 'teams');
  // "Limpar tudo": estado vazio -> save() esquece a chave
  S.participantes = []; S.teams = []; S.teamOf = {};
  App.Store.save();
  S.participantes = ['Fantasma']; // muda algo p/ detectar restore indevido
  ok('save() com estado vazio esquece o rascunho (restore() = false)', App.Store.restore() === false);
}

/* -------------------------------------------------------------------------- */
console.log('🏇 Sorteio (Turfe) — testes' + (UPDATE ? ' [--update]' : ''));
testSyntax();
const App = loadApp();
testDeterminism(App);
testQR(App);
testPersistence(App);
console.log('\n' + (failures === 0 ? '==> TUDO OK ✓' : `==> ${failures} FALHA(S) ✗`));
process.exit(failures === 0 ? 0 : 1);
