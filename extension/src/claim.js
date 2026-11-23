// Récupération : la page ouverte est-elle bien celle du jeu ? Dans le doute, la réponse est non.
import { sameGameStrict, titlesMatch, titleContains, titleTokens } from './titles.js';

const STORE_HOSTS = {
  epic: /(^|\.)epicgames\.com$/,
  steam: /(^|\.)steampowered\.com$/,
  gog: /(^|\.)gog\.com$/,
  ubisoft: /(^|\.)ubisoft\.com$/,
  itch: /(^|\.)itch\.io$/,
  indiegala: /(^|\.)indiegala\.com$/,
};

const PRODUCT_PAGE = [
  /^https:\/\/store\.epicgames\.com\/(?:[^/]+\/)?(?:p|bundles)\/[^/?#]+/,
  /^https:\/\/store\.steampowered\.com\/app\/\d+/,
  /^https:\/\/www\.gog\.com\/(?:[a-z]{2}\/)?game\/[^/?#]+/,
  /^https:\/\/store\.ubisoft\.com\/.+\.html/,
  /^https:\/\/register\.ubisoft\.com\/[^/?#]+/,
  /^https:\/\/(?!www\.)[a-z0-9-]+\.itch\.io\/[^/?#]+/,
  /^https:\/\/freebies\.indiegala\.com\/[^/?#]+/,
];
export const isProductPage = (url) => PRODUCT_PAGE.some((re) => re.test(url || ''));

const parse = (url) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

export function storeOfUrl(url) {
  const u = parse(url);
  return (u?.protocol === 'https:' && Object.keys(STORE_HOSTS).find((s) => STORE_HOSTS[s].test(u.hostname))) || null;
}

// Étapes qui suivent la page du jeu (commande Epic, téléchargement itch.io) : elles n'ont de sens qu'après elle.
export const isNextStep = (url) => {
  const u = parse(url);
  if (!u) return false;
  if (STORE_HOSTS.epic.test(u.hostname)) return /^\/(?:[^/]+\/)?purchase/.test(u.pathname);
  return STORE_HOSTS.itch.test(u.hostname) && /^\/[^/]+\/(?:purchase|download)(?:\/|$)/.test(u.pathname);
};

const cleanUrl = (u) =>
  String(u || '').split(/[?#]/)[0].replace(/\/$/, '').replace(/\/(?:fr|en|en-us|fr-fr|fr-FR|en-US)(?=\/)/, '');

const epicSlug = (url) => /store\.epicgames\.com\/(?:[^/]+\/)?(?:p|bundles)\/([^/?#]+)/.exec(url || '')?.[1] || null;
export const steamApp = (url) => /store\.steampowered\.com\/app\/(\d+)/.exec(url || '')?.[1] || null;

// « Save 100% on Hades on Steam », « Hades | Téléchargez… - Epic Games Store » → « Hades »
export const gameInPageTitle = (title) => String(title || '')
  .replace(/^\s*(?:save|économisez|-)?\s*\d{1,3}\s?%\s*(?:on|sur|de remise sur)?\s+/i, '')
  .split(/\s+\|\s+/)[0]
  .replace(/\s+-\s+galaFreebies\s*$/i, '')
  .replace(/\s+(?:on|sur|chez)\s+(?:steam|gog\.com|gog|epic games(?: store)?|ubisoft(?: \w+)?)\s*$/i, '')
  .replace(/^\s*(?:buy|acheter|get|obtenir)\s+/i, '')
  .trim();

function titleIsGame(pageTitle, gameTitle, store) {
  let t = gameInPageTitle(pageTitle);
  if (store === 'itch') t = t.replace(/\s+by\s+.+$/i, ''); // « Jeu by Studio »
  if (!t) return false;
  if (sameGameStrict(t, gameTitle) || titlesMatch(t, gameTitle)) return true;
  // Titre long seulement, sinon « Hades » irait avec « Hades Star »
  return titleTokens(gameTitle).length >= 3 && titleContains(t, gameTitle);
}

/**
 * Cette page est-elle celle du jeu ?
 * L'adresse tranche quand on la connaît ; sinon (lien GamerPower) il faut le bon store et le bon titre.
 */
export function isGamePage(game, state, url, pageTitle = '') {
  if (storeOfUrl(url) !== game.store || !isProductPage(url)) return false;
  const slug = epicSlug(url);
  if (slug) {
    const known = [game.slug, epicSlug(state?.resolvedUrl)].filter(Boolean);
    return known.length ? known.includes(slug) : titleIsGame(pageTitle, game.title, game.store);
  }
  const app = steamApp(url);
  if (app) {
    const known = game.appid || state?.appid;
    return known ? String(known) === app : titleIsGame(pageTitle, game.title, game.store);
  }
  const known = state?.resolvedUrl || (isProductPage(game.url) ? game.url : null);
  return known ? cleanUrl(known) === cleanUrl(url) : titleIsGame(pageTitle, game.title, game.store);
}

/** Jeu gratuit correspondant à une page visitée normalement (sans « Récupérer ») : par l'adresse seulement. */
export function matchByUrl(games, stateOf, url) {
  if (!isProductPage(url)) return null;
  return games.find((g) => {
    const s = stateOf(g);
    const known = epicSlug(url) ? g.slug || s.resolvedUrl : steamApp(url) ? g.appid || s.appid : s.resolvedUrl || isProductPage(g.url);
    return !!known && isGamePage(g, s, url);
  }) || null;
}
