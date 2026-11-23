// Accès aux sites : seuls Epic et Steam sont demandés à l'installation. Les autres le sont selon ce que tu choisis,
// et le navigateur te demande ton accord.
import { wants } from './prefs.js';

const GOG = 'https://www.gog.com/*';
const GOG_CATALOG = 'https://catalog.gog.com/*';
const UBISOFT = ['https://store.ubisoft.com/*', 'https://register.ubisoft.com/*'];
const ITCH_PAGES = 'https://*.itch.io/*';
const INDIEGALA_FREE = 'https://freebies.indiegala.com/*';
const CHEAPSHARK = 'https://www.cheapshark.com/*';
const DEALABS = 'https://www.dealabs.com/*';
const ITCH = 'https://itch.io/*';
const LOOT = 'https://feed.eikowagenknecht.com/*';
const NINTENDO = ['https://searching.nintendo-europe.com/*', 'https://api.ec.nintendo.com/*'];

/** Sites utiles avec ces réglages (GamerPower et Barter.vg sont ouverts à tous : rien à demander). */
export function originsFor(settings) {
  const w = wants(settings);
  const st = settings.pc ? settings.stores || {} : {};
  const bundle = (id) => w.bundles && settings.bundleStores?.[id] !== false;
  const out = [];
  const add = (on, ...origins) => { if (on) out.push(...origins.flat()); };
  add(w.free, LOOT);
  add(w.free || w.pcDeals || w.bundles, 'https://www.ecb.europa.eu/*');
  add(w.pcDeals || bundle('stores'), CHEAPSHARK);
  add(st.gog, GOG, GOG_CATALOG);
  add(st.ea && w.pcDeals, 'https://www.ea.com/*');
  add(st.ubisoft && w.free, UBISOFT);
  add(st.itch && w.free, ITCH_PAGES);
  add(st.indiegala && w.free, INDIEGALA_FREE);
  add(bundle('humble'), 'https://www.humblebundle.com/*');
  add(bundle('keys'), 'https://www.fanatical.com/*', 'https://www.greenmangamingbundles.com/*');
  add(bundle('indie'), ITCH, 'https://www.indiegala.com/*');
  add(w.switchDeals, NINTENDO);
  add(w.keyshops && (w.switchDeals || (w.pcDeals && st.steam)), 'https://www.eneba.com/*', 'https://www.instant-gaming.com/*');
  add(w.keyshops && w.switchDeals, 'https://www.kinguin.net/*');
  add(w.keyshops && w.pcDeals && st.steam, 'https://www.nexarda.com/*');
  add(settings.dealabs && (w.free || w.pcDeals || w.switchDeals || w.bundles), DEALABS);
  return [...new Set(out)];
}

// Sites sans lesquels une source ne peut pas marcher (les autres se contentent de ce qui est autorisé).
const SOURCE_SITES = {
  lootscraper: [LOOT], cheapshark: [CHEAPSHARK], gog: [GOG_CATALOG], ea: ['https://www.ea.com/*'], eshop: NINTENDO,
  dealabs: [DEALABS], dealabsPages: [DEALABS], itchbundles: [ITCH], goglib: [GOG], rate: ['https://www.ecb.europa.eu/*'],
};
export const DENIED = 'accès non autorisé';

const granted = (origin) => (globalThis.chrome?.permissions ? chrome.permissions.contains({ origins: [origin] }) : Promise.resolve(true));

export async function missingOrigins(settings) {
  const list = originsFor(settings);
  const ok = await Promise.all(list.map(granted));
  return list.filter((_, i) => !ok[i]);
}

/** Noms des sources à ne pas appeler, faute d'accès. */
export async function deniedSources() {
  const out = new Set();
  for (const [name, origins] of Object.entries(SOURCE_SITES)) {
    if (!(await Promise.all(origins.map(granted))).every(Boolean)) out.add(name);
  }
  return out;
}

/** À appeler directement dans un clic : le navigateur l'exige. Sans effet visible si tout est déjà accordé. */
export function requestAccess(origins) {
  return origins.length ? chrome.permissions.request({ origins }).catch(() => false) : Promise.resolve(true);
}

export const siteName = (origin) => origin.replace(/^https:\/\/(?:\*\.|www\.)?/, '').replace('/*', '');

// ---------- Pages où un jeu se récupère ----------
// Epic et Steam sont dans le manifest ; les autres ne sont actives que si leur site est autorisé.
const CLAIM_SITES = { gog: [GOG], ubisoft: UBISOFT, itch: [ITCH_PAGES], indiegala: [INDIEGALA_FREE] };

export async function syncClaimScripts() {
  if (!chrome.scripting?.registerContentScripts) return;
  const want = [];
  for (const [id, matches] of Object.entries(CLAIM_SITES)) {
    if ((await Promise.all(matches.map(granted))).every(Boolean)) {
      want.push({ id: `claim-${id}`, matches, js: ['content/claim.js'], runAt: 'document_idle', allFrames: true, persistAcrossSessions: true });
    }
  }
  const have = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
  const drop = have.filter((id) => !want.some((w) => w.id === id));
  if (drop.length) await chrome.scripting.unregisterContentScripts({ ids: drop });
  const add = want.filter((w) => !have.includes(w.id));
  if (add.length) await chrome.scripting.registerContentScripts(add);
}
