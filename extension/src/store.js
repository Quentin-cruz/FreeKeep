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
    'deals', 'dealCache', 'dealHistory', 'dealStates', 'seenDeals',
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
  };
}

export async function saveData(partial) {
  await chrome.storage.local.set(partial);
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

export async function setClaimTabs(claimTabs) {
  await chrome.storage.session.set({ claimTabs });
}
