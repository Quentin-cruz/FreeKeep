// Fonctions utilitaires partagées (service worker + popup).

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Texte « comparable » : minuscules, sans accents ni ponctuation.
export function normText(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const normTitle = normText;

// « Mark of the Deep (Epic Games) Giveaway » -> « Mark of the Deep »
export function cleanGamerPowerTitle(t) {
  let s = String(t ?? '').trim();
  s = s.replace(/\s*\([^)]*\)\s*(?=(?:key\s+)?giveaway\s*$)/i, ' ');
  s = s.replace(/\s+(?:steam|epic games|epic|gog|ubisoft)?\s*(?:key\s+)?giveaway\s*$/i, '');
  s = s.replace(/\s*\((?:steam|epic games(?: store)?|gog(?:\.com)?|ubisoft(?: connect)?|pc)\)\s*$/i, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// Deux titres désignent-ils le même jeu ?
export function titlesMatch(a, b) {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 5 && long.startsWith(short + ' ')) {
    // « X » vs « X Definitive Edition » = même jeu, mais « Hades » vs « Hades II » = suite
    const next = long.slice(short.length + 1).split(' ')[0];
    if (!/^(\d+|[ivx]{1,4})$/.test(next)) return true;
  }
  const wa = new Set(na.split(' '));
  const wb = new Set(nb.split(' '));
  if (wa.size < 2 || wb.size < 2) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter) >= 0.8;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', trade: '™', reg: '®', copy: '©' };
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// « 2026-11-27 23:59:59 » (UTC) -> timestamp ms, ou null
export function parseUtc(s) {
  if (!s || /^n\/?a$/i.test(String(s).trim())) return null;
  const t = Date.parse(String(s).trim().replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return Number.isFinite(t) ? t : null;
}

export async function fetchWithTimeout(url, { timeout = 15000, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('délai dépassé');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts) {
  const res = await fetchWithTimeout(url, opts);
  return res.json();
}

export async function fetchText(url, opts) {
  const res = await fetchWithTimeout(url, opts);
  return res.text();
}

// « 3,78€ », « 1 299,99 € », « 4.49 » -> nombre ; « Gratuit » -> 0 ; sinon null
export function parsePrice(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/gratuit|free|offert/i.test(s)) return 0;
  const m = /(\d{1,3}(?:[\s  .]\d{3})*|\d+)(?:[.,](\d{1,2}))?/.exec(s);
  if (!m) return null;
  const int = m[1].replace(/[\s  .]/g, '');
  return Number(`${int}.${m[2] || '0'}`);
}

export function stripHtml(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Le titre long contient-il le titre court (mots entiers) ? Utile pour « Hades (Steam, dématérialisé) ».
export function titleContains(long, short) {
  const l = ` ${normTitle(long)} `;
  const s = normTitle(short);
  if (s.length < 5) return false;
  const idx = l.indexOf(` ${s} `);
  if (idx < 0) return false;
  // « Hades » ne doit pas matcher « Hades II »
  const next = l.slice(idx + s.length + 2).split(' ')[0];
  return !/^(\d+|[ivx]{1,4})$/.test(next);
}

export function formatPrice(value, currency = 'EUR') {
  if (value == null || Number.isNaN(value)) return '';
  if (value === 0) return 'Gratuit';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

// ---------- Formatage (popup) ----------

export function formatDuration(ms) {
  if (ms <= 0) return 'terminé';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return h ? `${d} j ${h} h` : `${d} j`;
  if (h > 0) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  return `${Math.max(m, 1)} min`;
}

export function formatDate(ms) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(ms);
}

export function formatShortDate(ms) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
}

export function formatAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return "à l'instant";
  return `il y a ${formatDuration(diff)}`;
}
