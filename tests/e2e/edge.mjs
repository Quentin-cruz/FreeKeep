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
  await until('stores/stores');
  console.log('✔ la flèche suit le curseur, sans sauter de catégorie');
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
  for (let i = 0; i < 40 && !(await where()).startsWith('done/'); i++) await next();
  await until('done//bouton');
  await next();
  await sleep(1500);
  const saved = await run(ob, "import('/src/store.js').then((m) => m.getSettings())");
  assert.ok(saved.onboarded && saved.prime && saved.autoClick === false);
  assert.ok(await run(ob, "import('/src/store.js').then((m) => m.getDraft()).then((d) => d === null)"));
  console.log('✔ réglages enregistrés');

  const pop = await open('popup/popup.html?tab=1', 420, 700);
  await sleep(2000);
  assert.ok(await run(pop, "document.querySelector('#onboard').hidden && document.querySelectorAll('.section:not([hidden])').length >= 3"));
  assert.ok(await run(pop, 'document.documentElement.scrollWidth <= innerWidth'));
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
