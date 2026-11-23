// Bibliothèque et liste de souhaits Steam.
//  - Session : store.steampowered.com donne les jeux possédés et la liste de souhaits du compte déjà connecté
//    dans le navigateur. Aucun identifiant n'est demandé ni enregistré.
//  - Profil (facultatif) : Steam exige désormais une connexion pour la liste de jeux, même publique. Le lien du
//    profil sert donc au nom, à la liste de souhaits publique et, si tu es connecté, aux noms des jeux.
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

const profileUrl = (p) => `${ENDPOINTS.steamCommunity}/${p.kind}/${encodeURIComponent(p.id)}`;

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

// Jeux possédés + liste de souhaits du compte connecté. Sans connexion, Steam répond avec des listes vides.
export function parseSteamSession(data) {
  if (!data || !Array.isArray(data.rgOwnedApps)) throw new Error('réponse Steam inattendue');
  if (!data.rgOwnedApps.length && !(data.rgOwnedPackages || []).length) {
    throw new Error('pas connecté à store.steampowered.com dans ce navigateur');
  }
  return { appids: data.rgOwnedApps.map(String), wishlist: (data.rgWishlist || []).map(String) };
}

export async function fetchSteamSession() {
  return parseSteamSession(await fetchJson(`${ENDPOINTS.steamUserData}?t=${Date.now()}`, { credentials: 'include' }));
}

// Fiche publique d'un profil : accessible sans connexion.
export function parseProfileXml(xml) {
  const text = String(xml || '');
  if (/<error>/i.test(text)) throw new Error('profil introuvable : vérifie le lien');
  const steamID64 = /<steamID64>(\d+)<\/steamID64>/i.exec(text)?.[1];
  if (!steamID64) throw new Error('réponse Steam inattendue (lien invalide ?)');
  return { steamID64, profileName: decodeEntities(unCdata(/<steamID>([\s\S]*?)<\/steamID>/i.exec(text)?.[1] || '')) };
}

export async function fetchSteamProfile(input) {
  const profile = parseSteamProfile(input);
  if (!profile) throw new Error('lien de profil Steam non reconnu');
  return { ...parseProfileXml(await fetchText(`${profileUrl(profile)}/?xml=1`)), profile };
}

/**
 * Réunit tout ce qui est lisible. Ne lève pas d'erreur : `error` dit pourquoi les jeux manquent,
 * `wishlistError` pourquoi la liste de souhaits manque.
 * @param input      lien de profil (facultatif)
 * @param useSession lire aussi la session Steam du navigateur
 */
export async function fetchSteamLibrary({ input = '', useSession = true } = {}) {
  const out = { steamID64: null, profileName: '', appids: [], names: [], wishlist: null, error: null, wishlistError: null };
  const message = (e) => String(e?.message || e);
  const appids = new Set();
  let sessionError = null;
  let profileError = null;
  let profile = null;

  if (useSession) {
    try {
      const session = await fetchSteamSession();
      session.appids.forEach((id) => appids.add(id));
      out.wishlist = session.wishlist;
    } catch (e) {
      sessionError = message(e);
    }
  }

  if (input) {
    try {
      const res = await fetchSteamProfile(input);
      profile = res.profile;
      out.steamID64 = res.steamID64;
      out.profileName = res.profileName;
    } catch (e) {
      profileError = message(e);
    }
  }
  if (profile && useSession && !sessionError) {
    // Meilleur effort : les noms servent à reconnaître les jeux possédés sur Dealabs (annonces sans appid).
    try {
      const { games } = parseGamesXml(await fetchText(`${profileUrl(profile)}/games/?tab=all&xml=1`, { timeout: 25000, credentials: 'include' }));
      for (const g of games) {
        appids.add(g.appid);
        if (g.name) out.names.push(g.name);
      }
    } catch (e) {
      console.warn('[FreeKeep] noms des jeux Steam :', e);
    }
  }
  if (!out.wishlist && out.steamID64) {
    try {
      out.wishlist = await fetchSteamWishlist(out.steamID64);
    } catch (e) {
      out.wishlistError = message(e);
    }
  }

  out.appids = [...appids];
  if (!out.appids.length) {
    out.error = profileError || sessionError
      || (useSession ? 'aucun jeu trouvé sur ton compte Steam' : 'Steam ne montre plus tes jeux sans connexion : active la lecture via ta session Steam');
  }
  return out;
}

// Liste de souhaits publique (meilleur effort : silencieux si Steam la refuse).
async function fetchSteamWishlist(steamID64) {
  if (!steamID64) return [];
  const data = await fetchJson(`${ENDPOINTS.steamWishlist}?steamid=${steamID64}`);
  return (data?.response?.items || []).map((i) => String(i.appid)).filter(Boolean);
}
