// Source officielle Epic Games Store : jeux gratuits en cours + à venir.
import { ENDPOINTS, COUNTRY, LOCALE } from '../config.js';
import { fetchJson } from '../util.js';

const IMAGE_PRIORITY = ['OfferImageWide', 'DieselStoreFrontWide', 'featuredMedia', 'Thumbnail', 'OfferImageTall', 'DieselStoreFrontTall'];

export async function fetchEpic(now = Date.now()) {
  const url = `${ENDPOINTS.epic}?locale=${LOCALE}&country=${COUNTRY}&allowCountries=${COUNTRY}`;
  const data = await fetchJson(url);
  return parseEpic(data, now);
}

const flatOffers = (groups) => (groups || []).flatMap((g) => g?.promotionalOffers || []);
const isFreeOffer = (o) => o?.discountSetting?.discountPercentage === 0;

export function parseEpic(data, now = Date.now()) {
  const elements = data?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) throw new Error('réponse Epic inattendue');

  const out = [];
  for (const el of elements) {
    if (!el?.title) continue;
    const current = flatOffers(el.promotions?.promotionalOffers);
    const upcoming = flatOffers(el.promotions?.upcomingPromotionalOffers);
    const discountPrice = el.price?.totalPrice?.discountPrice;

    let status = null;
    let offer = null;
    const active = current.find((o) => isFreeOffer(o) && Date.parse(o.startDate) <= now && now < Date.parse(o.endDate));
    if (active && (discountPrice === 0 || discountPrice == null)) {
      status = 'active';
      offer = active;
    } else {
      const next = upcoming
        .filter((o) => isFreeOffer(o) && Date.parse(o.endDate) > now)
        .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0];
      if (next) {
        status = 'upcoming';
        offer = next;
      }
    }
    if (!status) continue;

    const slug = pickSlug(el);
    const isBundle = el.offerType === 'BUNDLE';
    out.push({
      source: 'epic',
      store: 'epic',
      title: el.title,
      slug,
      url: slug
        ? `https://store.epicgames.com/${LOCALE}/${isBundle ? 'bundles' : 'p'}/${slug}`
        : `https://store.epicgames.com/${LOCALE}/free-games`,
      images: pickImages(el.keyImages),
      start: Date.parse(offer.startDate) || null,
      end: Date.parse(offer.endDate) || null,
      status,
      worth: pickWorth(el),
      description: (el.description || '').slice(0, 280),
    });
  }
  return out;
}

function pickSlug(el) {
  const mapping =
    (el.offerMappings || []).find((m) => m?.pageSlug) ||
    (el.catalogNs?.mappings || []).find((m) => m?.pageSlug);
  let slug = mapping?.pageSlug || el.productSlug || null;
  if (slug) slug = slug.replace(/\/home$/, '');
  if (!slug || slug === '[]') return null;
  return slug;
}

function pickImages(keyImages = []) {
  const urls = [];
  for (const type of IMAGE_PRIORITY) {
    const img = keyImages.find((k) => k?.type === type && k.url);
    if (img) urls.push(withResize(img.url));
  }
  return [...new Set(urls)];
}

function withResize(url) {
  if (url.includes('?')) return url;
  return `${url}?w=480&h=270&resize=1&quality=medium`;
}

function pickWorth(el) {
  const p = el.price?.totalPrice;
  if (!p || !p.originalPrice) return null;
  if (p.fmtPrice?.originalPrice && p.fmtPrice.originalPrice !== '0') return p.fmtPrice.originalPrice;
  const decimals = p.currencyInfo?.decimals ?? 2;
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: p.currencyCode || 'EUR' })
      .format(p.originalPrice / 10 ** decimals);
  } catch {
    return null;
  }
}
