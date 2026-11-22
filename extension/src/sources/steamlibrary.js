// Bibliothèque Steam à partir du lien d'un profil PUBLIC (aucune connexion, aucune clé).
// Prérequis côté Steam : Profil + « Détails des jeux » en Public.
import { ENDPOINTS } from '../config.js';
import { fetchText, fetchJson, decodeEntities } from '../util.js';

// Accepte : lien /id/xxx ou /profiles/7656…, lien de la page jeux, SteamID64 seul, ou nom personnalisé seul.
export function parseSteamProfile(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = /steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)/i.exec(s);
  if (m) return { kind: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  if (/^7656\d{13}$/.test(s)) return { kind: 'profiles', id: s };
  if (/^[\w-]{2,32}$/.test(s)) return { kind: 'id', id: s };
  return null;
}

export const profileUrl = (p) => `${ENDPOINTS.steamCommunity}/${p.kind}/${encodeURIComponent(p.id)}`;

const unCdata = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

export function parseGamesXml(xml) {
  const text = String(xml || '');
  const err = /<error>([\s\S]*?)<\/error>/i.exec(text)?.[1];
  if (err) {
    const msg = unCdata(err);
    if (/private/i.test(msg)) throw new Error('profil privé : passe « Profil » et « Détails des jeux » en Public');
    if (/could not be found|not found/i.test(msg)) throw new Error('profil introuvable : vérifie le lien');
    throw new Error(msg);
  }
  if (!/<gamesList/i.test(text)) throw new Error('réponse Steam inattendue (profil privé ou lien invalide ?)');
  const steamID64 = /<steamID64>(\d+)<\/steamID64>/i.exec(text)?.[1] || null;
  const profileName = decodeEntities(unCdata(/<steamID>([\s\S]*?)<\/steamID>/i.exec(text)?.[1] || ''));
  const games = [];
  for (const m of text.matchAll(/<game>([\s\S]*?)<\/game>/gi)) {
    const appid = /<appID>(\d+)<\/appID>/i.exec(m[1])?.[1];
    const name = decodeEntities(unCdata(/<name>([\s\S]*?)<\/name>/i.exec(m[1])?.[1] || ''));
    if (appid) games.push({ appid, name });
  }
  return { steamID64, profileName, games };
}

export async function fetchSteamLibrary(input) {
  const profile = parseSteamProfile(input);
  if (!profile) throw new Error('lien de profil Steam non reconnu');
  const xml = await fetchText(`${profileUrl(profile)}/games/?tab=all&xml=1`, { timeout: 25000 });
  const lib = parseGamesXml(xml);
  if (!lib.games.length) throw new Error('0 jeu visible : passe « Détails des jeux » en Public dans ta confidentialité Steam');
  return { ...lib, profile };
}

// Liste de souhaits publique (meilleur effort : silencieux si Steam la refuse).
export async function fetchSteamWishlist(steamID64) {
  if (!steamID64) return [];
  const data = await fetchJson(`${ENDPOINTS.steamWishlist}?steamid=${steamID64}`);
  return (data?.response?.items || []).map((i) => String(i.appid)).filter(Boolean);
}
