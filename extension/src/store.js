// Accès au stockage de l'extension.
//  - chrome.storage.sync  : réglages (suivent ton compte Chrome)
//  - chrome.storage.local : jeux, états (récupéré / masqué), cache des sources
//  - chrome.storage.session : onglets ouverts via « Récupérer »
import { DEFAULT_SETTINGS } from './config.js';

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    stores: { ...DEFAULT_SETTINGS.stores, ...(settings?.stores || {}) },
  };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

export async function getData() {
  const d = await chrome.storage.local.get([
    'games', 'states', 'meta', 'cache', 'seen',
    'deals', 'dealCache', 'dealHistory', 'dealStates', 'seenDeals', 'steamLib', 'gogLib', 'appInfo',
  ]);
  return {
    games: d.games || [],
    states: d.states || {},
    meta: d.meta || {},
    cache: d.cache || {},
    seen: d.seen || [],
    deals: d.deals || [],
    dealCache: d.dealCache || {},
    dealHistory: d.dealHistory || {},
    dealStates: d.dealStates || {},
    seenDeals: d.seenDeals || [],
    steamLib: d.steamLib || {},
    gogLib: d.gogLib || {},
    appInfo: d.appInfo || {},
  };
}

export async function saveData(partial) {
  await chrome.storage.local.set(partial);
}

// Une seule écriture à la fois : sans ça, deux actions qui lisent puis enregistrent en même temps s'écrasent.
// Ne pas appeler `locked` depuis un travail déjà verrouillé (il s'attendrait lui-même).
let queue = Promise.resolve();
export function locked(job) {
  const run = queue.then(job);
  queue = run.catch(() => {}); // une erreur ne bloque pas les suivants
  return run;
}

// Lit les données à jour, laisse `change` les modifier, puis enregistre ce qu'il renvoie (rien si vide).
export function updateData(change) {
  return locked(async () => {
    const partial = await change(await getData());
    if (partial) await saveData(partial);
  });
}

// État fusionné d'un jeu (un jeu peut avoir plusieurs clés selon les sources).
export function stateFor(states, game) {
  const out = {};
  for (const k of game.keys || [game.key]) {
    const s = states[k];
    if (!s) continue;
    for (const [field, value] of Object.entries(s)) {
      if (out[field] === undefined || (value && !out[field])) out[field] = value;
    }
  }
  return out;
}

// Applique un changement d'état à toutes les clés d'un jeu.
// La clé principale garde un « snapshot » pour l'historique des jeux récupérés.
export function patchState(states, game, patch) {
  const keys = game.keys || [game.key];
  keys.forEach((k, i) => {
    const prev = states[k] || {};
    if (i === 0) {
      states[k] = {
        ...prev,
        ...patch,
        snapshot: {
          title: game.title,
          store: game.store,
          url: game.url,
          images: (game.images || []).slice(0, 3),
          worth: game.worth ?? null,
        },
      };
      delete states[k].alias;
    } else {
      states[k] = { ...prev, ...patch, alias: keys[0] };
    }
  });
}

// Clés liées à une entrée d'historique (pour annuler un « récupéré »).
export function keysForHistory(states, key) {
  return [key, ...Object.keys(states).filter((k) => states[k]?.alias === key)];
}

export async function getClaimTabs() {
  const { claimTabs } = await chrome.storage.session.get('claimTabs');
  return claimTabs || {};
}

export function updateClaimTabs(change) {
  return locked(async () => {
    const claimTabs = await getClaimTabs();
    change(claimTabs);
    await chrome.storage.session.set({ claimTabs });
  });
}
