// Le vrai service worker, dans un navigateur simulé : les clics et les réglages changés pendant une vérification
// ne doivent pas se perdre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { epicFixture } from './fixtures.js';
import { DEFAULT_SETTINGS, DEAL_SOURCES } from '../extension/src/config.js';

const tick = () => new Promise((r) => setImmediate(r));

// Stockage asynchrone qui rend des copies, comme chrome.storage.
function storageArea() {
  let data = {};
  return {
    async get(keys) {
      await tick();
      const list = keys == null ? Object.keys(data) : [].concat(keys);
      return structuredClone(Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]])));
    },
    async set(values) {
      const copy = structuredClone(values);
      await tick();
      Object.assign(data, copy);
    },
    async clear() {
      await tick();
      data = {};
    },
  };
}

const event = () => {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), listeners };
};

let nextTab = 1;
let notified = []; // textes des notifications
const noop = async () => {};
globalThis.chrome = {
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (p) => p, openOptionsPage: noop },
  alarms: { onAlarm: event(), get: noop, create: noop },
  storage: { onChanged: event(), sync: storageArea(), local: storageArea(), session: storageArea() },
  tabs: {
    onRemoved: event(),
    create: async () => { await tick(); return { id: nextTab++ }; },
    sendMessage: noop,
  },
  notifications: { onClicked: event(), onButtonClicked: event(), create: (id, n) => notified.push(`${n.title} ${n.message}`), clear: () => {} },
  action: { setBadgeBackgroundColor: noop, setBadgeTextColor: noop, setBadgeText: noop, setTitle: noop, openPopup: noop },
};

// Réseau : Epic répond quand le test le décide, les autres sources tout de suite.
let gate = null;
let epicCalls = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('freeGamesPromotions')) {
    epicCalls++;
    if (gate) await gate.promise;
    return new Response(JSON.stringify(epicFixture(Date.now())));
  }
  if (String(url).includes('/search/results')) return new Response(JSON.stringify({ results_html: '' }));
  return new Response('[]');
};
const closeGate = () => {
  gate = {};
  gate.promise = new Promise((r) => { gate.open = r; });
};

await import('../extension/background.js');
const onMessage = chrome.runtime.onMessage.listeners[0];
const send = (msg, sender = {}) => new Promise((resolve) => onMessage(msg, sender, resolve));

async function setup() {
  gate = null;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, onboarded: true, pcDeals: false, dealabs: false, steamOwnedSync: false, gogSessionSync: false, excludedGenres: [] } });
  const state = await send({ type: 'refresh' });
  const active = state.games.filter((g) => g.status === 'active');
  assert.ok(active.length >= 2, 'il faut au moins deux jeux actifs');
  return active;
}

// Lance une vérification bloquée sur le réseau, exécute `job`, puis la laisse finir.
async function duringRefresh(job) {
  closeGate();
  const refreshing = send({ type: 'refresh' });
  for (let i = 0; i < 20; i++) await tick(); // la vérification a lu ses données et attend le réseau
  assert.equal((await send({ type: 'getState' })).refreshing, true);
  await job();
  gate.open();
  await refreshing;
  return send({ type: 'getState' });
}

test('« Je l’ai » cliqué pendant une vérification est gardé', async () => {
  const [game] = await setup();
  const after = await duringRefresh(() => send({ type: 'setClaimed', key: game.key, claimed: true }));
  assert.equal(after.states[game.key]?.claimed, true);
});

test('Annuler « Je l’ai » pendant une vérification est gardé', async () => {
  const [game] = await setup();
  await send({ type: 'setClaimed', key: game.key, claimed: true });
  const after = await duringRefresh(() => send({ type: 'setClaimed', key: game.key, claimed: false }));
  assert.equal(after.states[game.key].claimed, false);
});

test('Masquer un jeu et un bon plan pendant une vérification est gardé', async () => {
  const [game] = await setup();
  const after = await duringRefresh(async () => {
    await send({ type: 'setHidden', key: game.key, hidden: true });
    await send({ type: 'setDealHidden', id: 'cs:1', hidden: true });
  });
  assert.equal(after.states[game.key]?.hidden, true);
  assert.equal(after.dealStates['cs:1']?.hidden, true);
});

test('Jeu détecté « dans la bibliothèque » sur une page pendant une vérification', async () => {
  const [game] = await setup();
  const after = await duringRefresh(() => send({ type: 'claim:owned', key: game.key }));
  assert.equal(after.states[game.key]?.claimed, true);
});

test('Plusieurs clics en même temps : aucun n’écrase l’autre', async () => {
  const [a, b] = await setup();
  await Promise.all([
    send({ type: 'setClaimed', key: a.key, claimed: true }),
    send({ type: 'setHidden', key: b.key, hidden: true }),
    send({ type: 'setDealHidden', id: 'cs:1', hidden: true }),
    send({ type: 'setDealHidden', id: 'cs:2', hidden: true }),
  ]);
  const { states, dealStates } = await send({ type: 'getState' });
  assert.equal(states[a.key]?.claimed, true);
  assert.equal(states[b.key]?.hidden, true);
  assert.deepEqual(Object.keys(dealStates).sort(), ['cs:1', 'cs:2']);
});

test('Deux « Récupérer » rapprochés : les deux onglets restent suivis', async () => {
  const [a, b] = await setup();
  await Promise.all([send({ type: 'openClaim', key: a.key }), send({ type: 'openClaim', key: b.key })]);
  const { claimTabs } = await chrome.storage.session.get('claimTabs');
  assert.deepEqual(Object.values(claimTabs).sort(), [a.key, b.key].sort());
});

test('Tout effacer pendant une vérification : les anciennes données ne reviennent pas', async () => {
  const [game] = await setup();
  await send({ type: 'setClaimed', key: game.key, claimed: true });
  await chrome.storage.local.set({ seen: ['ancien'] });
  closeGate();
  const refreshing = send({ type: 'refresh' });
  for (let i = 0; i < 20; i++) await tick();
  const resetting = send({ type: 'resetData' });
  for (let i = 0; i < 20; i++) await tick();
  gate.open();
  await Promise.all([refreshing, resetting]);
  const { states } = await send({ type: 'getState' });
  assert.equal(states[game.key]?.claimed, undefined);
  const { seen } = await chrome.storage.local.get('seen');
  assert.ok(!seen.includes('ancien'));
});

test('Une erreur dans une action ne bloque pas les suivantes', async () => {
  const [game] = await setup();
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error('disque plein'); };
  const res = await send({ type: 'setClaimed', key: game.key, claimed: true });
  chrome.storage.local.set = set;
  assert.match(res.error, /disque plein/);
  const after = await send({ type: 'setClaimed', key: game.key, claimed: true });
  assert.equal(after.states[game.key].claimed, true);
});

// ---------- Réglages changés pendant une vérification ----------

// Enregistre des réglages et prévient le service worker, comme le fait le navigateur.
async function changeSettings(patch) {
  const { settings: oldValue } = await chrome.storage.sync.get('settings');
  const newValue = { ...oldValue, ...patch };
  await chrome.storage.sync.set({ settings: newValue });
  chrome.storage.onChanged.listeners.forEach((fn) => fn({ settings: { oldValue, newValue } }, 'sync'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 1700; // le service worker attend 1,5 s après un changement de réglage
async function idle() {
  for (let i = 0; i < 400; i++) {
    const state = await send({ type: 'getState' });
    if (!state.refreshing) return state;
    await sleep(5);
  }
  throw new Error('la vérification ne finit pas');
}
async function startBlocked() {
  closeGate();
  send({ type: 'refresh' });
  for (let i = 0; i < 20; i++) await tick();
}

test('Réglage changé pendant une vérification : une nouvelle part avec les bons réglages', async () => {
  await setup();
  await startBlocked();
  await changeSettings({ stores: { ...DEFAULT_SETTINGS.stores, epic: false } });
  await sleep(DEBOUNCE);
  gate.open();
  const { games } = await idle();
  assert.equal(games.filter((g) => g.store === 'epic').length, 0, 'Epic décoché : plus aucun jeu Epic');
});

test('Plusieurs réglages changés pendant une vérification : une seule relance', async () => {
  await setup();
  await startBlocked();
  epicCalls = 0;
  await changeSettings({ level: 'wide' });
  await sleep(DEBOUNCE);
  await changeSettings({ level: 'strict' });
  await sleep(DEBOUNCE);
  gate.open();
  await idle();
  assert.equal(epicCalls, 1);
});

test('Fin du tutoriel : la vérification déjà lancée avec ces réglages n’est pas refaite', async () => {
  await setup();
  epicCalls = 0;
  await changeSettings({ level: 'wide' });
  closeGate();
  send({ type: 'refresh', force: ['steamlib', 'wishlist', ...DEAL_SOURCES] });
  await sleep(DEBOUNCE);
  gate.open();
  await idle();
  assert.equal(epicCalls, 1);
});

test('« Vérifier maintenant » pendant une vérification : une nouvelle part ensuite', async () => {
  await setup();
  await startBlocked();
  epicCalls = 0;
  const manual = send({ type: 'refresh', force: ['cheapshark'] });
  for (let i = 0; i < 20; i++) await tick();
  gate.open();
  await manual;
  assert.equal(epicCalls, 1);
});

test('Ouvrir le popup pendant une vérification : pas de relance inutile', async () => {
  await setup();
  await startBlocked();
  epicCalls = 0;
  const popup = send({ type: 'refresh' });
  for (let i = 0; i < 20; i++) await tick();
  gate.open();
  await popup;
  await idle();
  assert.equal(epicCalls, 0);
});

test('Notifications coupées pendant une vérification : aucune ne part', async () => {
  await setup();
  await chrome.storage.local.set({ seen: [] });
  notified = [];
  await startBlocked();
  await changeSettings({ notifyNew: false, notifyLastDay: false });
  gate.open();
  await idle();
  assert.deepEqual(notified, []);
});

test('Jeu banni pendant une vérification : pas de notification pour lui, mais pour les autres si', async () => {
  const [banned, other] = await setup();
  await chrome.storage.local.set({ seen: [] });
  notified = [];
  await startBlocked();
  await changeSettings({ bannedKeywords: [banned.title] });
  await sleep(50);
  gate.open(); // la vérification finit avant même que la relance soit programmée
  await sleep(DEBOUNCE);
  await idle();
  const text = notified.join(' | ');
  assert.ok(!text.includes(banned.title), text);
  assert.ok(text.includes(other.title), text);
});

// ---------- Fréquences courtes, profil Steam ----------

test('Vérification toutes les 5 minutes : alarme réglée, Epic pas relu à chaque fois', async () => {
  await setup();
  let period = null;
  chrome.alarms.create = async (name, o) => { period = o.periodInMinutes; };
  await changeSettings({ intervalHours: 5 / 60 });
  await sleep(30);
  chrome.alarms.create = noop;
  assert.equal(period, 5);
  epicCalls = 0;
  chrome.alarms.onAlarm.listeners[0]({ name: 'freekeep-refresh' });
  await idle();
  assert.equal(epicCalls, 0, 'données de moins de 15 min : réutilisées');
  const { games } = await send({ type: 'getState' });
  assert.ok(games.some((g) => g.store === 'epic'), 'les jeux restent affichés');
  await send({ type: 'refresh' });
  assert.equal(epicCalls, 1, 'demandé à la main : relu');
});

test('Tutoriel : le lien de profil annonce les jeux possédés', async () => {
  await setup();
  const real = globalThis.fetch;
  let owned = [10, 20, 30];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('dynamicstore/userdata')) return new Response(JSON.stringify({ rgOwnedApps: owned, rgOwnedPackages: [], rgWishlist: owned.length ? [7] : [] }));
    if (u.includes('/games/')) return new Response('<html>login</html>');
    if (u.includes('xml=1')) return new Response('<profile><steamID64>76561198000000001</steamID64><steamID><![CDATA[Test]]></steamID></profile>');
    if (u.includes('IWishlistService')) return new Response(JSON.stringify({ response: { items: [{ appid: 7 }, { appid: 8 }] } }));
    return real(url);
  };
  try {
    const ok = await send({ type: 'testSteamProfile', input: 'https://steamcommunity.com/id/test', useSession: true });
    assert.equal(ok.count, 3);
    assert.equal(ok.ownedError, null);
    owned = [];
    const out = await send({ type: 'testSteamProfile', input: 'https://steamcommunity.com/id/test', useSession: true });
    assert.equal(out.count, 0);
    assert.match(out.ownedError, /pas connecté/);
    assert.equal(out.wishlistCount, 2);
    const bad = await send({ type: 'testSteamProfile', input: 'https://example.com/x' });
    assert.match(bad.error, /non reconnu/);
  } finally {
    globalThis.fetch = real;
  }
});
