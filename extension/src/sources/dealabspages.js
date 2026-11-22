// Pages de groupe Dealabs : plus riches que le RSS (température, prix de référence, offres expirées)
// et elles remontent plusieurs semaines. Si elles ne répondent pas, le RSS prend le relais.
import { ENDPOINTS } from '../config.js';
import { fetchText, decodeEntities, stripHtml } from '../util.js';

const pause = () => new Promise((r) => setTimeout(r, 800));
const PAGES = { switch: ['jeux-nintendo-switch', 3], pc: ['jeux-pc', 2], free: ['jeux-gratuits', 1] };

export function parseDealabsPage(html, feed) {
  const out = [];
  for (const m of String(html || '').matchAll(/data-vue3='([^']*ThreadMainListItemNormalizer[^']*)'/g)) {
    let t;
    try {
      t = JSON.parse(decodeEntities(m[1]))?.props?.thread;
    } catch {
      continue;
    }
    if (!t?.threadId || !t.title || t.type !== 'Deal') continue;
    const link = `https://www.dealabs.com/bons-plans/${t.titleSlug}-${t.threadId}`;
    const img = t.mainImage;
    out.push({
      guid: link,
      link,
      feed,
      title: t.title,
      pubDate: Number(t.publishedAt) * 1000 || null,
      category: t.mainGroup?.threadGroupName || '',
      description: stripHtml(t.listCardDescription || ''),
      merchant: t.merchant?.merchantName || '',
      priceText: t.price ? `${t.price}€` : t.price === 0 && t.nextBestPrice ? '0€' : '',
      image: img?.path && img?.name ? `https://static-pepper.dealabs.com/${img.path}/${img.name}/re/300x300/qt/60/${img.name}.jpg` : null,
      temperature: Math.round(Number(t.temperature) || 0),
      refPrice: Number(t.nextBestPrice) || null,
      end: Number(t.endDate?.timestamp) * 1000 || null,
      expired: !!(t.isExpired || t.isGone || t.deletedAt),
      local: !!t.isLocal && t.selectedLocations?.isNational !== true, // en ligne : isLocal est faux
      verified: true, // Dealabs dit que l'offre tient toujours
    });
  }
  return out;
}

export async function fetchDealabsPages(feeds) {
  const out = [];
  let failed = null;
  for (const feed of feeds) {
    const [group, pages] = PAGES[feed];
    for (let page = 1; page <= pages; page++) {
      try {
        const items = parseDealabsPage(await fetchText(`${ENDPOINTS.dealabsGroup}/${group}${page > 1 ? `?page=${page}` : ''}`, { timeout: 25000 }), feed);
        if (!items.length) break;
        out.push(...items);
      } catch (e) {
        failed = e;
        break;
      }
      await pause();
    }
  }
  if (!out.length) throw failed || new Error('pages Dealabs illisibles');
  return out;
}
