// Configuration centrale de FreeKeep.

export const REPO = 'https://github.com/Quentin-cruz/FreeKeep';
export const RAW_MANIFEST = 'https://raw.githubusercontent.com/Quentin-cruz/FreeKeep/main/extension/manifest.json';
export const COUNTRY = 'FR';
export const LOCALE = 'fr';

// ---------------------------------------------------------------------------
// Jeux gratuits à garder
// ---------------------------------------------------------------------------

// Plateformes PC où les jeux s'activent (= ce que l'utilisateur coche dans le tutoriel).
export const STORES = {
  steam:     { id: 'steam',     name: 'Steam',            short: 'Steam',     color: '#66c0f4', bg: '#1b2838' },
  epic:      { id: 'epic',      name: 'Epic Games',       short: 'Epic',      color: '#f4f4f5', bg: '#2b2b31' },
  ubisoft:   { id: 'ubisoft',   name: 'Ubisoft Connect',  short: 'Ubisoft',   color: '#9cc9ff', bg: '#0c3473' },
  gog:       { id: 'gog',       name: 'GOG',              short: 'GOG',       color: '#e9b8ff', bg: '#45185a' },
  ea:        { id: 'ea',        name: 'EA app',           short: 'EA',        color: '#ff8f8f', bg: '#4a1414' },
  battlenet: { id: 'battlenet', name: 'Battle.net',       short: 'Battle.net', color: '#7cc4ff', bg: '#0b2a4a' },
  microsoft: { id: 'microsoft', name: 'Microsoft Store',  short: 'MS Store',  color: '#8fe28f', bg: '#103a1c' },
  itch:      { id: 'itch',      name: 'itch.io',          short: 'itch.io',   color: '#ff9e9e', bg: '#5c1f24' },
  indiegala: { id: 'indiegala', name: 'IndieGala',        short: 'IndieGala', color: '#ffd27a', bg: '#3d2a0a' },
  other:     { id: 'other',     name: 'Autres (DRM-free…)', short: 'Autre',   color: '#fcd34d', bg: '#3f3212' },
  // Avantages Amazon Prime (ex-Prime Gaming, désormais dans Amazon Luna)
  amazon:    { id: 'amazon',    name: 'Amazon Games',     short: 'Amazon',    color: '#ffc15c', bg: '#2e2108', prime: true },
  legacy:    { id: 'legacy',    name: 'Legacy Games',     short: 'Legacy',    color: '#d0c2ff', bg: '#2a1f4a', prime: true },
  luna:      { id: 'luna',      name: 'Luna (cloud)',     short: 'Luna',      color: '#b9a4ff', bg: '#24164a', prime: true },
};

export const PC_STORE_ORDER = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'battlenet', 'microsoft', 'itch', 'indiegala', 'other'];

// Bundles : quatre choix
export const BUNDLE_STORES = {
  humble: { id: 'humble', name: 'Humble Bundle', short: 'Humble', color: '#ff8f8f', bg: '#4a1414', re: /humble/i },
  keys:   { id: 'keys', name: 'Fanatical + Green Man Gaming + Digiphile', short: 'Fanatical & co', color: '#ffc15c', bg: '#4a2f08', re: /fanatical|green ?man|\bgmg\b|digiphile/i },
  stores: { id: 'stores', name: 'Stores sélectionnés au-dessus', short: 'Mes stores', desc: 'Bundles vendus par Steam, GOG…', color: '#7cc4ff', bg: '#0b2a4a', re: /^\s*(?:steam|gog(?:\.com)?|epic(?: games)?(?: store)?|ubisoft(?: \w+)?|ea(?: app)?|electronic arts|microsoft(?: store)?|xbox(?: store)?|battle\.?net)\s*$/i },
  indie:  { id: 'indie', name: 'Indie sans DRM', short: 'Indie', desc: 'itch.io + IndieGala', color: '#ff9e9e', bg: '#5c1f24', re: /itch|indie ?gala/i },
};
/** Case de bundles d'un vendeur, ou null s'il n'est pas suivi. */
export const bundleStoreOf = (merchant) => Object.values(BUNDLE_STORES).find((b) => b.re.test(String(merchant || '')))?.id || null;

// Licences proposées à bannir
export const KEYWORD_SUGGESTIONS = [
  'EA Sports FC', 'Call of Duty', 'LEGO', 'Mortal Kombat', 'Hogwarts Legacy', "Assassin's Creed", 'Battlefield', 'BioShock', 'Borderlands', 'Dead Island', 'Killing Floor',
  'Mass Effect', 'Zombie Army', 'Les Sims', 'Farming Simulator', 'NBA 2K', 'Football Manager',
];
export const PRIME_STORES = ['amazon', 'legacy', 'luna'];
export const STORE_ORDER = [...PC_STORE_ORDER, ...PRIME_STORES];

// Plateformes Switch
export const SWITCH_PLATFORMS = {
  switch1: { label: 'Switch', short: 'Switch', color: '#f87171' },
  switch2: { label: 'Switch 2', short: 'Switch 2', color: '#fb7185' },
};

// Niveaux d'exigence (seuils des bons plans)
//  - limits : cartes montrées d'abord (le reste derrière « Voir tout ») ; bar : note Steam, nombre d'avis, votes Dealabs, jeux récents par bundle
export const LEVELS = {
  strict:   { label: 'Que les affaires de fou', emoji: '🔥', desc: 'Une trentaine d’annonces au plus, énormes remises.', pcMinDiscount: 75, gemMinDiscount: 80, gemMinRating: 95, switchMinDiscount: 60, pcMaxAge: 4,
    limits: { pc: 15, bundle: 5, switch: 10 }, bar: { rating: 85, reviews: 3000, votes: 300, bigVotes: 500, bundle: 3 } },
  balanced: { label: 'Équilibré', emoji: '⚖️', desc: 'Les meilleures remises sur des jeux récents ou très demandés.', pcMinDiscount: 60, gemMinDiscount: 70, gemMinRating: 90, switchMinDiscount: 40, pcMaxAge: 6,
    limits: { pc: 30, bundle: 10, switch: 20 }, bar: { rating: 78, reviews: 1000, votes: 150, bigVotes: 300, bundle: 2 } },
  wide:     { label: 'Large', emoji: '🌊', desc: 'Deux fois plus de choix, remises plus modestes.', pcMinDiscount: 40, gemMinDiscount: 50, gemMinRating: 85, switchMinDiscount: 30, pcMaxAge: 10,
    limits: { pc: 60, bundle: 20, switch: 40 }, bar: { rating: 70, reviews: 400, votes: 60, bigVotes: 150, bundle: 1 } },
};

// Sites d'où viennent les giveaways ponctuels (repérés dans le texte GamerPower).
export const GIVEAWAY_SITES = [
  { id: 'alienware', name: 'Alienware Arena', re: /alienware/i },
  { id: 'fanatical', name: 'Fanatical', re: /fanatical/i },
  { id: 'humble', name: 'Humble Bundle', re: /humble/i },
  { id: 'indiegala', name: 'IndieGala', re: /indie\s?gala/i },
  { id: 'prime', name: 'Amazon Prime', re: /prime gaming|amazon games|amazon prime|amazon luna|\bluna\b/i },
  { id: 'gamesplanet', name: 'Gamesplanet', re: /gamesplanet/i },
  { id: 'gmg', name: 'Green Man Gaming', re: /green ?man ?gaming/i },
  { id: 'steelseries', name: 'SteelSeries', re: /steelseries/i },
  { id: 'keyhub', name: 'Keyhub', re: /keyhub/i },
  { id: 'gleam', name: 'Gleam', re: /gleam\.io/i },
  { id: 'itch', name: 'itch.io', re: /itch\.io/i },
  { id: 'ea', name: 'EA', re: /\b(ea app|origin)\b/i },
  { id: 'ubisoft', name: 'Ubisoft', re: /ubisoft (?:store|connect)/i },
];

// ---------------------------------------------------------------------------
// Bons plans
// ---------------------------------------------------------------------------

export const CHANNELS = {
  official: { label: 'Store officiel', short: 'Officiel', color: '#93c5fd' },
  keyshop:  { label: 'Site de clés',   short: 'Clé',      color: '#fca5a5' },
  physical: { label: 'Boîte (physique)', short: 'Physique', color: '#fcd34d' },
  eshop:    { label: 'eShop Nintendo', short: 'eShop',    color: '#f87171' },
  bundle:   { label: 'Bundle',         short: 'Bundle',   color: '#c4b5fd' },
};

// Sites de clés (marché gris) : prix souvent plus bas, mais pas des stores officiels.
export const KEYSHOPS = [
  'eneba', 'instant gaming', 'instant-gaming', 'instantgaming', 'g2a', 'kinguin', 'gamivo', 'cdkeys', 'k4g',
  'driffle', 'hrk', 'mmoga', 'gocdkeys', 'g2play', 'difmark', 'keysforgames', 'royal cdkeys', 'gamesdeal',
  'allkeyshop', 'yuplay', 'cjs cdkeys', 'electronic first', 'gameseal', 'kinguin.net',
];

export const PC_STORES = [
  'steam', 'gog', 'epic games', 'fanatical', 'humble', 'gamesplanet', 'green man gaming', 'greenmangaming', 'gmg',
  'ubisoft', 'ea', 'battle.net', 'indiegala', 'gamersgate', 'wingamestore', 'dlgamer', 'gamebillet', 'voidu',
  'nuuvem', 'microsoft', 'xbox', '2game', 'noctre', 'dreamgame',
];

// Magasins de boîtes (jeux physiques).
export const PHYSICAL_STORES = [
  'amazon', 'fnac', 'cdiscount', 'leclerc', 'micromania', 'carrefour', 'auchan', 'cultura', 'rakuten', 'boulanger',
  'darty', 'smyths', 'king jouet', 'joueclub', 'intermarche', 'super u', 'hyper u', 'system u', 'la grande recre',
  'zavvi', 'coolshop', 'ldlc', 'toys r us', 'geant', 'galeries lafayette', 'e leclerc', 'cora', 'maxi toys',
  'la redoute', 'ebay', 'backmarket', 'gamecash', 'easy cash', 'cash express', 'just for games',
];

// Ce qui n'est pas un jeu (accessoires, consoles, abonnements…).
export const NOT_A_GAME = /\b(console|manettes?|joy-?con|pro controller|carte (?:micro ?sd|m[ée]moire|cadeau|pr[ée]pay[ée]e)|micro ?sd|pochette|housse|[ée]tui|sacoche|chargeur|station de charge|dock|c[âa]ble|abonnement|switch online|game ?pass|ps plus|playstation plus|amiibo|figurines?|peluche|t-shirt|sweat|casque|[ée]cran|moniteur|souris|clavier|si[èe]ge|chaise|ssd|disque dur|carte graphique|processeur|pc portable|tour pc|steam deck|goodies|artbook|vinyle|bande originale|protection d'[ée]cran|coque|support|batterie|grip|volant)\b/i;

export const ENDPOINTS = {
  epic: 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions',
  gamerpower: 'https://www.gamerpower.com/api/filter',
  steamSearch: 'https://store.steampowered.com/search/results/',
  steamUserData: 'https://store.steampowered.com/dynamicstore/userdata/',
  cheapsharkDeals: 'https://www.cheapshark.com/api/1.0/deals',
  cheapsharkGames: 'https://www.cheapshark.com/api/1.0/games',
  cheapsharkStores: 'https://www.cheapshark.com/api/1.0/stores',
  cheapsharkRedirect: 'https://www.cheapshark.com/redirect',
  eshopSearch: 'https://searching.nintendo-europe.com/fr/select',
  eshopPrice: 'https://api.ec.nintendo.com/v1/price',
  dealabs: 'https://www.dealabs.com/rss',
  dealabsGroup: 'https://www.dealabs.com/groupe',
  ecb: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  steamItems: 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/',
  gogCatalog: 'https://catalog.gog.com/v1/catalog',
  eaDeals: 'https://www.ea.com/fr-fr/sales/deals',
  barter: 'https://barter.vg/bundles/json/',
  lootscraper: 'https://feed.eikowagenknecht.com',
  itchBundles: 'https://itch.io/bundles',
  fanatical: 'https://www.fanatical.com/api/all/fr',
  enebaSwitch: 'https://www.eneba.com/fr/store/nintendo-games',
  kinguin: 'https://www.kinguin.net/services/library/api/v1/products/search',
  igSwitch: 'https://www.instant-gaming.com/fr/nintendo/',
  enebaPc: 'https://www.eneba.com/fr/store/steam-games',
  igPc: 'https://www.instant-gaming.com/fr/pc/steam/',
  nexardaFind: 'https://www.nexarda.com/api/v3/find',
  nexardaPrices: 'https://www.nexarda.com/api/v3/prices',
  steamCommunity: 'https://steamcommunity.com',
  steamWishlist: 'https://api.steampowered.com/IWishlistService/GetWishlist/v1/',
  steamStoreSearch: 'https://store.steampowered.com/api/storesearch/',
  gogUser: 'https://www.gog.com/userData.json',
  gogOwned: 'https://www.gog.com/account/getFilteredProducts',
};

export const DEFAULT_SETTINGS = {
  onboarded: false,       // tutoriel terminé ?

  // Mes plateformes
  pc: true,
  switch: false,
  switch2: false,
  stores: {
    steam: true, epic: true, ubisoft: true, gog: true, ea: true, battlenet: true, microsoft: true, itch: false, indiegala: true, other: false,
    amazon: true, legacy: false, luna: false,
  },
  prime: false,           // abonné Amazon Prime (jeux offerts chaque mois via Luna, ex-Prime Gaming)

  // Ce que je veux voir
  freeGames: true,        // jeux PC gratuits à garder
  showUpcoming: true,     // jeux Epic de la semaine prochaine
  pcDeals: true,
  switchDeals: true,
  physical: true,         // jeux en boîte (magasins)
  keyshops: true,         // sites de clés (marché gris)
  bundles: true,
  bundleStores: { humble: true, keys: true, stores: true, indie: true },
  level: 'balanced',      // strict | balanced | wide | custom
  pcMinDiscount: 60,      // seuils (utilisés quand level = custom)
  gemMinDiscount: 70,
  gemMinRating: 90,
  switchMinDiscount: 40,
  pcMaxAge: 6,            // au-delà, un jeu passe derrière « Voir tout » (ans)

  // Ce que je ne veux pas voir
  excludedGenres: ['adult'],
  bannedKeywords: [],

  // Bibliothèque Steam
  steamProfile: '',       // lien du profil public
  hideOwned: true,        // masquer les promos sur les jeux possédés
  useWishlist: true,      // mettre en avant la liste de souhaits
  steamOwnedSync: true,   // jeux possédés + liste de souhaits via la session Steam du navigateur
  gogSessionSync: true,   // jeux GOG possédés via la session gog.com du navigateur

  // Dealabs
  dealabs: true,
  dealabsOnlyHot: true,
  departments: '',        // départements pour les deals en magasin (ex. "80, 60")
  dealMaxAgeDays: 7,

  // Alertes
  intervalHours: 0.25,
  notifyNew: true,
  notifyLastDay: true,
  notifyDeals: true,
  notifyWishlist: true,

  // Récupération : agit sur ton compte, donc jamais sans un « oui » explicite
  autoClick: false,

  checkUpdates: true,     // prévenir d'une nouvelle version sur GitHub
};

// Sources à relire quand un réglage de bons plans change.
export const DEAL_SOURCES = ['cheapshark', 'wanted', 'eshop', 'pckeys', 'gog', 'ea', 'bundles', 'storebundles', 'itchbundles', 'switchkeys', 'dealabsPages'];

// Fréquence des vérifications, en heures.
export const INTERVALS = [
  [5 / 60, 'Toutes les 5 minutes'], [10 / 60, 'Toutes les 10 minutes'], [15 / 60, 'Toutes les 15 minutes'], [0.5, 'Toutes les 30 minutes'],
  [1, 'Toutes les heures'], [3, 'Toutes les 3 heures'], [6, 'Toutes les 6 heures'], [12, 'Toutes les 12 heures'], [24, 'Une fois par jour'],
];

export const ALARM_NAME = 'freekeep-refresh';
export const STALE_AFTER_MS = 30 * 60 * 1000; // le popup relance une vérif si la dernière date de +30 min
