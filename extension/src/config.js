// Configuration centrale de FreeKeep.

export const COUNTRY = 'FR';
export const LOCALE = 'fr';

// ---------------------------------------------------------------------------
// Jeux gratuits à garder
// ---------------------------------------------------------------------------

export const STORES = {
  epic:    { id: 'epic',    name: 'Epic Games Store', short: 'Epic',    color: '#f4f4f5', bg: '#2b2b31' },
  steam:   { id: 'steam',   name: 'Steam',            short: 'Steam',   color: '#66c0f4', bg: '#1b2838' },
  gog:     { id: 'gog',     name: 'GOG',              short: 'GOG',     color: '#e9b8ff', bg: '#45185a' },
  ubisoft: { id: 'ubisoft', name: 'Ubisoft Connect',  short: 'Ubisoft', color: '#9cc9ff', bg: '#0c3473' },
  other:   { id: 'other',   name: 'Autres (itch.io, DRM-free, Battle.net…)', short: 'Autre', color: '#fcd34d', bg: '#3f3212' },
};

export const STORE_ORDER = ['epic', 'steam', 'gog', 'ubisoft', 'other'];

// Sites d'où viennent les giveaways ponctuels (repérés dans le texte GamerPower).
export const GIVEAWAY_SITES = [
  { id: 'alienware', name: 'Alienware Arena', re: /alienware/i },
  { id: 'fanatical', name: 'Fanatical', re: /fanatical/i },
  { id: 'humble', name: 'Humble Bundle', re: /humble/i },
  { id: 'indiegala', name: 'IndieGala', re: /indie\s?gala/i },
  { id: 'prime', name: 'Prime Gaming', re: /prime gaming|amazon games|amazon prime/i },
  { id: 'gamesplanet', name: 'Gamesplanet', re: /gamesplanet/i },
  { id: 'gmg', name: 'Green Man Gaming', re: /green ?man ?gaming/i },
  { id: 'steelseries', name: 'SteelSeries', re: /steelseries/i },
  { id: 'keyhub', name: 'Keyhub', re: /keyhub/i },
  { id: 'gleam', name: 'Gleam', re: /gleam\.io/i },
  { id: 'itch', name: 'itch.io', re: /itch\.io/i },
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
  ggdeals: 'https://api.gg.deals/v1/prices/by-steam-app-id/',
};

export const DEFAULT_SETTINGS = {
  // Jeux gratuits
  stores: { epic: true, steam: true, gog: true, ubisoft: true, other: true },
  intervalHours: 1,       // fréquence de vérification (heures)
  notifyNew: true,        // notif quand un nouveau jeu passe gratuit
  notifyLastDay: true,    // rappel quand il reste moins de 24 h
  autoClick: true,        // clic auto sur « Obtenir » quand on passe par « Récupérer »
  steamOwnedSync: true,   // détecte les jeux Steam déjà possédés (session Steam du navigateur)
  showUpcoming: true,     // affiche les jeux Epic de la semaine prochaine

  // Bons plans PC
  pcDeals: true,
  pcMinDiscount: 60,      // remise mini sur les gros jeux (%)
  gemMinDiscount: 70,     // remise mini sur les pépites (%)
  gemMinRating: 90,       // note Steam mini d'une pépite (%)
  ggdealsKey: '',         // clé API GG.deals (facultative) -> prix des sites de clés

  // Switch
  switchDeals: true,
  switchMinDiscount: 40,  // remise mini sur l'eShop (%)

  // Dealabs (physique, sites de clés, erreurs de prix)
  dealabs: true,
  dealabsOnlyHot: true,   // seulement les deals validés « hot » par la communauté (+ erreurs de prix)
  departments: '80',      // départements pour les deals en magasin (ex. "80, 60")
  dealMaxAgeDays: 7,

  notifyDeals: true,      // notif pour les affaires exceptionnelles
};

export const ALARM_NAME = 'freekeep-refresh';
export const STALE_AFTER_MS = 30 * 60 * 1000; // le popup relance une vérif si la dernière date de +30 min
