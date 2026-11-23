// Essai complet dans un vrai Edge, invisible, avec un profil jetable : tutoriel, réglages, popup.
//   npm run test:edge            (Windows ; autre chemin : EDGE="/chemin/vers/msedge")
// La synchronisation et la connexion Windows sont coupées : rien ne touche à ton compte.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9378;
const root = fileURLToPath(new URL('../../', import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'freekeep-e2e-'));
const ext = path.join(work, 'extension');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Copie avec les accès déjà donnés : le navigateur ne peut pas montrer sa question en mode invisible.
fs.cpSync(path.join(root, 'extension'), ext, { recursive: true });
const manifestPath = path.join(ext, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_host_permissions;
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(work, 'profil')}`, `--load-extension=${ext}`,
  '--disable-sync', '--disable-features=msImplicitSignin,DisableLoadExtensionCommandLineSwitch', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let seq = 0;
const pending = {};
const exceptions = [];
let ws;
const cdp = (method, params = {}, sessionId) => new Promise((resolve) => {
  seq += 1;
  pending[seq] = resolve;
  ws.send(JSON.stringify({ id: seq, method, params, sessionId }));
});

async function connect() {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((r) => { ws.onopen = r; });
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id) {
          pending[d.id]?.(d);
          delete pending[d.id];
        } else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
      };
      return;
    } catch { /* Edge démarre */ }
  }
  throw new Error('Edge ne répond pas');
}

async function attach(targetId) {
  const { result } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, result.sessionId);
  return result.sessionId;
}

const run = async (session, expression) => {
  const { result } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session);
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result?.result?.value;
};

async function findExtension() {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const { result } = await cdp('Target.getTargets');
    for (const t of result.targetInfos.filter((x) => x.type === 'service_worker' && x.url.endsWith('/background.js'))) {
      const session = await attach(t.targetId);
      const name = await run(session, 'chrome.runtime.getManifest().name').catch(() => '');
      await cdp('Target.detachFromTarget', { sessionId: session });
      if (/FreeKeep/.test(name)) return new URL(t.url).host;
    }
  }
  throw new Error('extension non chargée');
}

async function main() {
  await connect();
  const id = await findExtension();
  const open = async (file, width, height) => {
    const { result } = await cdp('Target.createTarget', { url: `chrome-extension://${id}/${file}` });
    await sleep(1500);
    const session = await attach(result.targetId);
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
    await cdp('Page.bringToFront', {}, session);
    return session;
  };

  const ob = await open('onboarding/onboarding.html', 1280, 800);
  assert.ok(await run(ob, 'chrome.storage.sync.get(null).then((x) => !x.settings)'), 'profil neuf attendu');
  const where = () => run(ob, "document.body.dataset.step + '/' + (document.querySelector('.part.active')?.dataset.part || '') + (document.querySelector('.ready') ? '/bouton' : '')");
  const next = async () => { await run(ob, "document.querySelector('#btn-next').click()"); await sleep(700); };
  const until = async (expected, max = 12000) => {
    for (let t = 0; t < max; t += 100) {
      if (await where() === expected) return;
      await sleep(100);
    }
    assert.equal(await where(), expected);
  };

  // Le vrai curseur de la souris, posé au milieu d'un élément
  const hover = async (selector) => {
    const box = await run(ob, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, ob);
    await sleep(500);
  };
  const click = async (selector) => { await run(ob, `document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(500); };

  await next();
  await until('platforms/machines');
  // Aucun minuteur : sans rien toucher, la flèche reste où elle est
  await sleep(5000);
  assert.equal(await where(), 'platforms/machines');
  // Page 2 : PC et Switch cochés, plus rien à cocher → la flèche descend seule sur « Switch 2 »
  await click('[data-part=machines] .tcard:nth-child(2)');
  await until('platforms/switch2');
  // Le bouton est refusé tant que « Switch 2 » n'a pas de réponse
  await hover('#btn-next');
  assert.equal(await where(), 'platforms/switch2');
  await click('[data-part=switch2] [data-answer=no]');
  await until('platforms/switch2/bouton');
  console.log('✔ page 2 : la flèche descend quand la réponse est complète, puis va au bouton');
  // Une réponse modifiée plus haut : la flèche ne remonte pas
  await hover('[data-part=switch2] [data-answer=yes]');
  await click('[data-part=switch2] [data-answer=yes]');
  await hover('[data-part=machines] .tcard:nth-child(1)');
  await click('[data-part=machines] .tcard:nth-child(1)');
  await click('[data-part=machines] .tcard:nth-child(1)');
  await sleep(800);
  assert.equal(await where(), 'platforms/switch2/bouton');
  console.log('✔ réponses modifiées plus haut : la flèche reste sur le bouton');
  await next();
  await until('stores/stores');
  // Le curseur descend : la flèche suit, une catégorie à la fois
  await hover('[data-part=bundles]');
  await until('stores/bundles');
  await hover('[data-part=prime]');
  assert.equal(await where(), 'stores/bundles', 'pas de saut tant que « Les bundles » n’a pas de réponse');
  await hover('[data-part=bundles] [data-answer=yes]');
  await click('[data-part=bundles] [data-answer=yes]');
  await until('stores/bundleSites');
  await hover('[data-part=prime]');
  await until('stores/prime');
  await hover('[data-part=stores]');
  await sleep(600);
  assert.equal(await where(), 'stores/prime', 'la flèche ne remonte pas');
  console.log('✔ la flèche suit le curseur vers le bas, sans sauter de catégorie, et ne remonte jamais');
  await hover('[data-part=prime]');
  await click('[data-part=prime] [data-answer=yes]');
  await until('stores/primeStores');
  console.log('✔ « Oui » à Prime ouvre la suite');
  await hover('#btn-next');
  await until('stores/primeStores/bouton');
  console.log('✔ curseur sur le bouton : la flèche y va');
  // Quitter puis revenir
  await next();
  await until('content/pc');
  await cdp('Page.reload', {}, ob);
  await sleep(1500);
  assert.match(await where(), /^content\//);
  assert.ok(await run(ob, "document.querySelector('#btn-back').style.visibility !== 'hidden'"));
  console.log('✔ le tutoriel reprend où il en était');
  // Aucune réponse cochée d'avance : on répond « Non », la 1re fréquence ou « Équilibré », sinon « Suite »
  const answerHere = `(() => {
    const p = document.querySelector('.part.active');
    if (!p || document.body.classList.contains('ready')) return false;
    const pick = (!p.querySelector('[data-answer].on') && p.querySelector('[data-answer=no]'))
      || (!p.querySelector('.chip.pick.on') && p.querySelector('.chip.pick'))
      || (!p.querySelector('[data-level].on') && p.querySelector('[data-level=balanced]'));
    if (!pick) return false;
    pick.click();
    return true;
  })()`;
  const step = async () => { if (await run(ob, answerHere)) await sleep(700); else await next(); };
  assert.equal(await run(ob, "document.querySelectorAll('[data-answer].on').length"), 0, 'rien de coché d’avance');
  for (let i = 0; i < 20 && (await where()) !== 'content/dept'; i++) await step();
  // Département : « OK » valide et la flèche descend
  await run(ob, "document.querySelector('[data-part=dept] input').value = '80'; document.querySelector('[data-part=dept] input').dispatchEvent(new Event('input', { bubbles: true }))");
  await click('[data-part=dept] .btn');
  await until('content/keyshops');
  console.log('✔ « OK » au département : la flèche passe à la suite');
  for (let i = 0; i < 20 && !(await where()).startsWith('level/'); i++) await step();
  // Page 5 : un message différent pour chaque niveau
  const callout = () => run(ob, "document.querySelector('[data-part=level] .callout').textContent");
  assert.match(await callout(), /Clique sur un niveau/);
  await click('[data-level=strict]');
  const strict = await callout();
  await click('[data-level=wide]');
  const wide = await callout();
  assert.ok(/Que les affaires de fou/.test(strict) && /Large/.test(wide) && strict !== wide, `${strict} / ${wide}`);
  console.log('✔ page 5 : un message par niveau');
  await click('[data-level=balanced]');
  for (let i = 0; i < 20 && !(await where()).startsWith('steam/'); i++) await step();
  // Page 6 : session Steam non connectée (profil jetable) → le profil public est proposé à la place
  await sleep(2500);
  assert.ok(await run(ob, "!document.querySelector('[data-part=profile]').hidden"), 'session absente : profil proposé');
  for (let i = 0; i < 40 && !(await where()).startsWith('done/'); i++) await step();
  await until('done//bouton');
  // L'installation ouvre aussi son propre onglet de tutoriel : on compte ceux qui restent
  const tutoTabs = async () => (await cdp('Target.getTargets')).result.targetInfos.filter((t) => t.type === 'page' && t.url.includes('onboarding.html')).length;
  const tabsBefore = await tutoTabs();
  await next();
  await sleep(1500);
  const saved = await run(ob, "import('/src/store.js').then((m) => m.getSettings())");
  assert.ok(saved.onboarded && saved.prime && saved.autoClick === false && saved.level === 'balanced' && saved.departments === '80', JSON.stringify({ prime: saved.prime, autoClick: saved.autoClick, level: saved.level }));
  for (const k of ['switch2', 'bundles', 'keyshops', 'hideOwned', 'useWishlist', 'intervalHours']) assert.notEqual(saved[k], undefined, k);
  assert.ok(await run(ob, "import('/src/store.js').then((m) => m.getDraft()).then((d) => d === null)"));
  console.log('✔ réglages enregistrés');
  await sleep(2500);
  assert.equal(await tutoTabs(), tabsBefore - 1, 'onglet du tutoriel fermé');
  console.log('✔ l’onglet du tutoriel se ferme tout seul');

  const pop = await open('popup/popup.html?tab=1', 420, 700);
  await sleep(2000);
  assert.ok(await run(pop, "document.querySelector('#onboard').hidden && document.querySelectorAll('.section:not([hidden])').length >= 3"));
  assert.ok(await run(pop, 'document.documentElement.scrollWidth <= innerWidth'));
  // Vrai format du popup (400 px), avec de gros compteurs : aucun débordement de côté
  const narrow = await open('popup/popup.html', 400, 600);
  await sleep(1500);
  await run(narrow, "document.querySelectorAll('.section .count').forEach((c) => { c.textContent = '188'; })");
  assert.ok(await run(narrow, 'document.documentElement.scrollWidth <= 400 && [...document.querySelectorAll(".section")].every((s) => s.getBoundingClientRect().right <= 400)'), 'onglets dans la largeur');
  const opt = await open('options/options.html', 1280, 900);
  assert.ok(await run(opt, "document.querySelectorAll('#nav button').length >= 5 && document.querySelector('#access').hidden"));
  console.log('✔ popup et réglages s’affichent');
  assert.deepEqual(exceptions, []);
}

let failed = null;
try {
  await main();
} catch (e) {
  failed = e;
}
try {
  if (ws) await Promise.race([cdp('Browser.close'), sleep(3000)]);
} catch { /* déjà fermé */ }
await sleep(1500);
edge.kill();
try {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
} catch { /* Edge tient encore un fichier : dossier temporaire, sans importance */ }
if (failed) {
  console.error('✖', failed);
  process.exit(1);
}
console.log('Tout passe.');
process.exit(0);
