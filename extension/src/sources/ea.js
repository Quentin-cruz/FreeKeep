// Offres officielles EA (page « Offres actuelles » du site EA, en euros).
import { ENDPOINTS } from '../config.js';
import { fetchText, parsePrice } from '../util.js';

export async function fetchEa(settings) {
  return parseEa(await fetchText(ENDPOINTS.eaDeals, { timeout: 20000 }), settings);
}

export function parseEa(html, settings) {
  const raw = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''))?.[1];
  if (!raw) throw new Error('page EA inattendue');
  const min = Math.max(40, settings.pcMinDiscount - 10);
  const out = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const p = node.price;
    if (node.slug && node.title && p?.displayTotalWithDiscount && p.currency === 'EUR') {
      const price = parsePrice(p.displayTotalWithDiscount);
      const normal = parsePrice(p.displayTotal);
      const discount = normal ? Math.round((1 - price / normal) * 100) : Number(p.discountPercentage) || 0;
      if (price != null && discount >= min && !node.isFreeToPlay && !out.has(node.slug)) {
        out.set(node.slug, {
          id: `ea:${node.slug}`,
          source: 'ea',
          section: 'pc',
          channel: 'official',
          title: String(node.title).replace(/\s+/g, ' ').trim(),
          url: ENDPOINTS.eaDeals,
          images: [node.packArt?.ar16X9, node.packArt?.ar4X3].filter(Boolean),
          price,
          normalPrice: normal,
          currency: 'EUR',
          discount,
          merchant: 'EA',
          platform: 'ea',
          categories: (node.genres || []).map((g) => g?.slug).filter(Boolean),
          posted: null,
          end: null,
          flags: { aaa: (normal ?? 0) >= 29 },
        });
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(JSON.parse(raw));
  return [...out.values()];
}
