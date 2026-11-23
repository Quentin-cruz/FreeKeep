// Accès au stockage de l'extension.
//  - chrome.storage.sync  : réglages (suivent ton compte Chrome)
//  - chrome.storage.local : jeux, états (récupéré / masqué), cache des sources
//  - chrome.storage.session : onglets ouverts via « Récupérer »
import { DEFAULT_SETTINGS } from './config.js';

// Le stockage synchronisé refuse plus de 8 Ko par entrée : une longue liste de licences est découpée.
const INLINE_MAX = 4000;
const CHUNK_MAX = 6000;
const CHUNK = /^banned_\d+$/;
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

function splitKeywords(list) {
  const chunks = [[]];
  let size = 2;
  for (const word of list) {
    const n = bytes(word) + 1;
    if (size + n > CHUNK_MAX && chunks.at(-1).length) {
      chunks.push([]);
      size = 2;
    }
    chunks.at(-1).push(word);
    size += n;
  }
  return chunks;
}

// Empreinte courte : le changement d'une liste découpée doit se voir dans `settings`.
const sum = (text) => {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) | 0;
  return n;
};

export async function getSettings() {
  const all = await chrome.storage.sync.get(null);
  const { bannedChunks, bannedSum, ggdealsKey, ...settings } = all.settings || {};
  if (bannedChunks) settings.bannedKeywords = Array.from({ length: bannedChunks }, (_, i) => all[`banned_${i}`] || []).flat();
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    stores: { ...DEFAULT_SETTINGS.stores, ...(settings.stores || {}) },
    bundleStores: { ...DEFAULT_SETTINGS.bundleStores, ...(settings.bundleStores || {}) },
  };
}

/** Lève une erreur si le navigateur refuse (liste vraiment trop longue, quota dépassé). */
export async function saveSettings(settings) {
  const { ggdealsKey, ...rest } = settings;
  const values = { settings: rest };
  const words = rest.bannedKeywords || [];
  if (bytes(words) > INLINE_MAX) {
    const chunks = splitKeywords(words);
    values.settings = { ...rest, bannedKeywords: [], bannedChunks: chunks.length, bannedSum: sum(words.join('\n')) };
    chunks.forEach((c, i) => { values[`banned_${i}`] = c; });
  }
  await chrome.storage.sync.set(values);
  const stale = Object.keys(await chrome.storage.sync.get(null)).filter((k) => CHUNK.test(k) && !(k in values));
  if (stale.length) await chrome.storage.sync.remove(stale);
}

// GG.deals n'est plus utilisé (il fallait un compte) : on efface l'ancienne clé, où qu'elle soit.
export async function forgetGgDealsKey() {
  await chrome.storage.local.remove('ggdealsKey');
  const { settings } = await chrome.storage.sync.get('settings');
  if (settings && 'ggdealsKey' in settings) await saveSettings(await getSettings());
}

// Tutoriel en cours : gardé à part tant qu'il n'est pas terminé.
export const getDraft = async () => (await chrome.storage.local.get('onboardDraft')).onboardDraft || null;
export const saveDraft = (value) => chrome.storage.local.set({ onboardDraft: value });
export const clearDraft = () => chrome.storage.local.remove('onboardDraft');

export async function getData() {
  const d = await chrome.storage.local.get([
    'games', 'states', 'meta', 'cache', 'seen',
    'deals', 'dealCache', 'dealHistory', 'dealStates', 'seenDeals', 'steamLib', 'gogLib', 'appInfo', 'nameIds', 'steamNames',
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
    nameIds: d.nameIds || {},
    steamNames: d.steamNames || {},
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
