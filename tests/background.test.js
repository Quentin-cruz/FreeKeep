// Le vrai service worker, dans un navigateur simulé : les clics faits pendant une vérification ne doivent pas se perdre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { epicFixture } from './fixtures.js';
import { DEFAULT_SETTINGS } from '../extension/src/config.js';

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
  notifications: { onClicked: event(), onButtonClicked: event(), create: () => {}, clear: () => {} },
  action: { setBadgeBackgroundColor: noop, setBadgeTextColor: noop, setBadgeText: noop, setTitle: noop, openPopup: noop },
};

// Réseau : Epic répond quand le test le décide, les autres sources tout de suite.
let gate = null;
globalThis.fetch = async (url) => {
  if (String(url).includes('freeGamesPromotions')) {
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
