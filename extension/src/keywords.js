// Licences bannies : tolère les variantes d'écriture (« Hogwart's Legacy », « NBA2K26 », « EA FC 27 »).
import { normText } from './util.js';

// Noms différents d'une même licence : bannir l'un bannit les autres.
const ALIASES = [
  ['ea sports fc', 'easports fc', 'ea fc', 'eafc', 'fifa', 'fc 24', 'fc 25', 'fc 26', 'fc 27', 'fc 28'],
  ['call of duty', 'cod black ops', 'cod modern warfare', 'cod warzone', 'cod mw', 'cod bo'],
  ['les sims', 'the sims', 'sims 3', 'sims 4'],
  ['hogwarts legacy', 'heritage de poudlard'],
  ['assassins creed', 'assassin creed'],
  ['nba 2k', 'nba2k'],
  ['wwe 2k', 'wwe2k'],
  ['farming simulator', 'farming simulateur'],
  ['mortal kombat', 'mortal combat', 'mk11', 'mk1'],
  ['lego', 'legos'],
  ['grand theft auto', 'gta'],
  ['counter strike', 'counterstrike'],
];

// « Hogwart's » et « Hogwarts » donnent la même chose, « L'Héritage » reste en deux mots.
const tokens = (s) => normText(String(s ?? '').replace(/(\p{L}{2,})['’`´](?=s\b)/giu, '$1')).split(' ').filter(Boolean);

// Au plus `max` lettres ajoutées, oubliées, remplacées ou inversées.
function closeEnough(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (before && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
    }
    before = prev;
    prev = row;
  }
  return prev[b.length] <= max;
}

// Un mot du titre correspond-il à un mot banni ? Les mots courts doivent être exacts (« LEGO » ≠ « Lega »).
function sameWord(word, banned, last) {
  if (word === banned) return true;
  // « 2k » → « 2k26 », « fc » → « fc27 » : le numéro de l'épisode collé
  if (last && word.startsWith(banned) && /^\d+$/.test(word.slice(banned.length))) return true;
  if (/\d/.test(word) || /\d/.test(banned)) return false;
  if (banned.length >= 4 && (word === `${banned}s` || `${word}s` === banned)) return true;
  if (banned.length >= 9) return closeEnough(word, banned, 2);
  if (banned.length >= 6) return closeEnough(word, banned, 1);
  return false;
}

function contains(title, banned) {
  if (!banned.length) return false;
  for (let i = 0; i + banned.length <= title.length; i++) {
    if (banned.every((b, j) => sameWord(title[i + j], b, j === banned.length - 1))) return true;
  }
  // Espaces en plus ou en moins : « NBA2K 26 », « Battle field »
  const compact = banned.join('');
  if (compact.length < 5) return /\d$/.test(compact) && title.includes(compact); // « FC26 »
  for (let i = 0; i < title.length; i++) {
    let joined = '';
    for (let j = i; j < title.length && joined.length < compact.length + 3; j++) {
      joined += title[j];
      if (joined === compact || (joined.startsWith(compact) && /^\d+$/.test(joined.slice(compact.length)))) return true;
    }
  }
  return false;
}

const variantsCache = new Map();
function variants(keyword) {
  if (variantsCache.has(keyword)) return variantsCache.get(keyword);
  const base = tokens(keyword);
  const out = [base];
  const group = base.length ? ALIASES.find((g) => g.some((a) => {
    const t = tokens(a);
    return t.length === base.length && t.every((w, i) => sameWord(base[i], w, i === t.length - 1));
  })) : null;
  for (const a of group || []) out.push(tokens(a));
  variantsCache.set(keyword, out);
  return out;
}

/** Premier mot-clé banni trouvé dans le titre, ou null. */
export function bannedKeyword(title, keywords = []) {
  const t = tokens(title);
  for (const kw of keywords) if (variants(String(kw)).some((v) => contains(t, v))) return kw;
  return null;
}
