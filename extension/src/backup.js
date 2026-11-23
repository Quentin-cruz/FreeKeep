// Sauvegarde : réglages, jeux récupérés, éléments masqués.
// À la lecture, rien n'est cru sur parole : seuls les champs connus, du bon type, sont repris.
import { DEFAULT_SETTINGS, LEVELS, INTERVALS } from './config.js';

const APP = 'FreeKeep<3';
export const MAX_FILE = 5 * 1024 * 1024;

export function makeBackup(settings, { states = {}, dealStates = {} } = {}, now = Date.now()) {
  const { ggdealsKey, onboarded, ...rest } = settings; // ggdealsKey : ancienne version
  return { app: APP, format: 1, date: new Date(now).toISOString(), settings: rest, states, dealStates };
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 300) => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v) => (Number.isFinite(v) ? v : undefined);
const link = (v) => (text(v, 2000)?.startsWith('https://') ? v : undefined);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const safeKey = (k) => k.length <= 300 && !['__proto__', 'constructor', 'prototype'].includes(k);

function readSettings(raw) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = raw[k];
    if (['ggdealsKey', 'onboarded'].includes(k) || typeof v !== typeof def || Array.isArray(v) !== Array.isArray(def)) continue;
    if (Array.isArray(def)) out[k] = v.filter((x) => text(x, 100)).slice(0, 4000);
    else if (isObject(def)) out[k] = Object.fromEntries(Object.keys(def).map((id) => [id, typeof v[id] === 'boolean' ? v[id] : def[id]]));
    else if (typeof v !== 'string' || text(v) !== undefined) out[k] = v;
  }
  if (!LEVELS[out.level] && out.level !== 'custom') delete out.level;
  if (!INTERVALS.some(([v]) => v === out.intervalHours)) delete out.intervalHours;
  return out;
}

const readState = (s) => compact({
  claimed: s.claimed === true || undefined,
  hidden: s.hidden === true || undefined,
  claimedAt: num(s.claimedAt),
  claimedVia: text(s.claimedVia, 20),
  alias: text(s.alias),
  remindedEnd: num(s.remindedEnd),
  resolvedUrl: link(s.resolvedUrl),
  appid: /^\d{1,10}$/.test(s.appid) ? String(s.appid) : undefined,
  snapshot: isObject(s.snapshot) && text(s.snapshot.title) ? compact({
    title: s.snapshot.title,
    store: text(s.snapshot.store, 20),
    url: link(s.snapshot.url),
    images: Array.isArray(s.snapshot.images) ? s.snapshot.images.filter(link).slice(0, 3) : [],
    worth: text(s.snapshot.worth, 40),
  }) : undefined,
});

/** Lit un fichier de sauvegarde, ou lève une erreur claire. */
export function readBackup(content) {
  if (content.length > MAX_FILE) throw new Error('fichier trop gros');
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('ce n’est pas une sauvegarde FreeKeep<3');
  }
  if (data?.app !== APP || !isObject(data.settings) || !isObject(data.states)) throw new Error('ce n’est pas une sauvegarde FreeKeep<3');
  if (data.format !== 1) throw new Error('sauvegarde d’une version plus récente : mets FreeKeep<3 à jour');
  const states = {};
  for (const [k, s] of Object.entries(data.states)) if (safeKey(k) && isObject(s)) states[k] = readState(s);
  const dealStates = {};
  for (const [k, s] of Object.entries(isObject(data.dealStates) ? data.dealStates : {})) {
    if (safeKey(k) && s?.hidden === true) dealStates[k] = { hidden: true, at: num(s.at) || 0 };
  }
  return { settings: readSettings(data.settings), states, dealStates };
}

/** Fusionne sans rien perdre : un jeu récupéré d'un côté le reste. */
export function mergeStates(current, incoming) {
  const out = { ...current };
  for (const [k, s] of Object.entries(incoming)) {
    const mine = out[k] || {};
    out[k] = { ...s, ...mine, ...(s.claimed || mine.claimed ? { claimed: true } : {}), ...(s.hidden || mine.hidden ? { hidden: true } : {}) };
    if (s.claimed && !mine.claimed) Object.assign(out[k], compact({ claimedAt: s.claimedAt, claimedVia: s.claimedVia }));
  }
  return out;
}
