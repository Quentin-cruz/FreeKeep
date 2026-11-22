// GG.deals (gg.deals) : prix actuels et historiques des stores officiels ET des sites de clés,
// en euros (région FR). Facultatif : nécessite une clé API gratuite (gg.deals > Settings > API).
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';
import { steamHeaderImages } from './cheapshark.js';

const num = (x) => (x == null || x === '' ? null : Number(x));

export async function fetchGgDeals(appids, key, region = 'fr') {
  const ids = [...new Set(appids.filter(Boolean).map(String))].slice(0, 100);
  if (!ids.length || !key) return {};
  const url = `${ENDPOINTS.ggdeals}?ids=${ids.join(',')}&key=${encodeURIComponent(key)}&region=${region}`;
  return parseGgDeals(await fetchJson(url));
}

export function parseGgDeals(data) {
  if (!data?.success) throw new Error(data?.data?.message || 'réponse GG.deals inattendue');
  const out = {};
  for (const [appid, v] of Object.entries(data.data || {})) {
    if (!v?.prices) continue;
    out[appid] = {
      title: v.title,
      url: v.url,
      retail: num(v.prices.currentRetail),
      keyshop: num(v.prices.currentKeyshops),
      histRetail: num(v.prices.historicalRetail),
      histKeyshop: num(v.prices.historicalKeyshops),
      currency: v.prices.currency || 'EUR',
    };
  }
  return out;
}

// Transforme les prix des sites de clés en bons plans quand ils sont exceptionnels :
// plus bas historique ET au moins 50 % sous le prix officiel actuel.
// (Les chutes soudaines par rapport à la vérif précédente sont détectées dans deals.js.)
export function ggKeyshopDeals(prices) {
  const out = [];
  for (const [appid, p] of Object.entries(prices)) {
    if (p.keyshop == null || p.keyshop <= 0) continue;
    const ref = p.retail ?? null;
    const discount = ref ? Math.round((1 - p.keyshop / ref) * 100) : null;
    const historicLow = p.histKeyshop != null && p.keyshop <= p.histKeyshop + 0.005;
    out.push({
      id: `gg:${appid}`,
      source: 'ggdeals',
      section: 'pc',
      channel: 'keyshop',
      title: p.title,
      url: p.url,
      images: steamHeaderImages(appid),
      price: p.keyshop,
      normalPrice: ref,
      currency: p.currency,
      discount,
      merchant: 'Sites de clés',
      steamAppID: appid,
      platform: 'steam',
      end: null,
      posted: null,
      flags: { historicLow, watch: true },
      // Visible seulement si exceptionnel (voir deals.js) : sinon simple surveillance.
      candidate: historicLow && discount != null && discount >= 50,
    });
  }
  return out;
}
