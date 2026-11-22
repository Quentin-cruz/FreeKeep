// Comparaison des titres de jeux, la même partout (gratuits, promos, bibliothèques, souhaits).
// « Part II » = « Part 2 », « Kombat11 » = « Kombat 11 », « Assassin's » = « Assassins », « Clean Up » = « Cleanup ».
import { normText } from './util.js';

const ROMAN = {
  ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
};
// « X » et « I » seuls restent des lettres : « Mega Man X » n'est pas « Mega Man 10 ».
const WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, i: 1, x: 10,
};
const PART = new Set(['part', 'partie', 'episode', 'chapter', 'chapitre', 'volume', 'vol', 'season', 'saison', 'act', 'acte', 'book', 'livre']);
const ARTICLES = new Set(['the', 'le', 'la', 'les', 'l', 'a', 'an']);
const LINKS = new Set(['and', 'et', 'n']);

// Mots qui changent l'édition, pas le jeu.
const EDITION = new Set([
  'definitive', 'edition', 'goty', 'game', 'of', 'the', 'year', 'complete', 'complet', 'complete', 'deluxe', 'ultimate', 'ultime', 'gold', 'standard', 'enhanced',
  'directors', 'director', 's', 'cut', 'collection', 'digital', 'numerique', 'limited', 'limitee', 'collectors', 'collector', 'premium', 'special', 'speciale', 'day',
]);

export function titleTokens(title) {
  const raw = normText(String(title ?? '').replace(/(\p{L}{2,})['’`´](?=s\b)/giu, '$1'))
    .replace(/\b([a-z]{4,})(\d{1,4})\b/g, '$1 $2') // « Kombat11 »
    .split(' ')
    .filter(Boolean);
  const out = [];
  raw.forEach((w, i) => {
    const prev = raw[i - 1];
    if (i === 0 && raw.length > 1 && ARTICLES.has(w)) return;
    if (LINKS.has(w)) return;
    if (PART.has(prev) && WORDS[w] != null) out.push(String(WORDS[w]));
    else if (i > 0 && ROMAN[w] != null) out.push(String(ROMAN[w]));
    else if (/^\d+$/.test(w)) out.push(String(Number(w)));
    else out.push(w);
  });
  return out;
}

const isNumber = (w) => /^\d+$/.test(w);
// « Battlefield 1 » est le 1er numéro écrit, « X » sans numéro est souvent le premier épisode : on compare les numéros tels quels.
const numbers = (tokens) => tokens.filter(isNumber).join(',');

// Retire les mots d'édition en fin de titre (« Deluxe Edition », « GOTY »).
function core(tokens) {
  let end = tokens.length;
  while (end > 1 && EDITION.has(tokens[end - 1])) end -= 1;
  return tokens.slice(0, end);
}

/** Clé d'un jeu, sans l'édition : deux annonces du même jeu ont la même clé. */
export const gameKey = (title) => core(titleTokens(title)).join('');

/** Même jeu au sens strict : titres identiques ou ne différant que par l'édition. */
export function sameGameStrict(a, b) {
  const ka = gameKey(a);
  return ka.length > 0 && ka === gameKey(b);
}

/** Même jeu, plus souple (sous-titre en plus, un mot de différence), jamais deux épisodes différents. */
export function titlesMatch(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.length || !tb.length) return false;
  const ca = core(ta);
  const cb = core(tb);
  if (ca.join('') === cb.join('')) return true;
  if (numbers(ca) !== numbers(cb)) return false;
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  // « X » et « X : sous-titre » ; un titre d'un ou deux mots est trop court pour conclure (DOOM / DOOM Eternal)
  if (short.length >= 3 && short.every((w, i) => w === long[i]) && !PART.has(long[short.length])) return true;
  const sa = new Set(ca);
  const sb = new Set(cb);
  if (sa.size < 3 || sb.size < 3) return false;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter += 1;
  return inter / (sa.size + sb.size - inter) >= 0.8;
}

/** Le titre long contient-il le jeu court, et pas un autre épisode ? (« Hades (Steam, dématérialisé) ») */
export function titleContains(long, short) {
  const l = titleTokens(long);
  const s = core(titleTokens(short));
  if (s.join('').length < 5) return false;
  for (let i = 0; i + s.length <= l.length; i++) {
    if (!s.every((w, j) => w === l[i + j])) continue;
    const next = l[i + s.length];
    if (next === undefined || !(isNumber(next) || PART.has(next))) return true;
  }
  return false;
}

/** Nom du jeu dans une annonce : « [Précommande] Jeu Hades II sur Nintendo Switch 2 (Dématérialisé) » → « Hades II ». */
export function extractGameName(title) {
  return String(title || '')
    .replace(/^\s*(\[[^\]]*\]\s*)+/, '')
    .replace(/^(?:le\s+)?jeu\s+(?:(?:pc|nintendo switch(?: ?[12])?|switch(?: ?[12])?)\s+)?(?=\S)/i, '')
    .split(/\s+(?:sur|pour|on)\s+(?:pc|steam|epic|gog|nintendo|switch|ps\d|playstation|xbox)\b/i)[0]
    .replace(/\s*[([].*$/, '')
    .replace(/\s+[-–]\s+(?:nintendo )?switch.*$/i, '')
    .replace(/\s+[-–]\s+(?:[ée]dition|edition|day one|limited|deluxe).*$/i, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+(?:nintendo\s+)?switch(?:\s*[12])?\s*$/i, '')
    .trim();
}
