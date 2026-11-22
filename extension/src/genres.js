// Genres que l'utilisateur peut exclure, et comment les reconnaître selon la source :
//  - steam : genres officiels Steam (appdetails)
//  - descriptors : avertissements de contenu Steam (3 = contenu sexuel adulte, 4 = nudité/sexe fréquents)
//  - tags : tags joueurs Steam (SteamSpy), seulement les plus votés
//  - eshop : catégories de l'eShop Nintendo
//  - kw : mots dans le titre (dernier recours, pour Epic, GOG, Dealabs…)
export const GENRES = [
  { id: 'adult', label: 'Contenu adulte', emoji: '🔞', steam: ['Sexual Content', 'Nudity'], descriptors: [3, 4], tags: ['Sexual Content', 'Nudity', 'Hentai', 'NSFW'], kw: /\b(hentai|nsfw|18\+|uncensored)\b/i },
  { id: 'horror', label: 'Horreur', emoji: '👻', tags: ['Horror', 'Psychological Horror', 'Survival Horror'], eshop: ['horror'], kw: /\b(horror|horreur|zombies?|resident evil|silent hill|outlast|amnesia|five nights)\b/i },
  { id: 'sport', label: 'Sport', emoji: '⚽', steam: ['Sports'], tags: ['Sports', 'Football (Soccer)', 'Soccer', 'Basketball', 'Football (American)', 'Golf', 'Tennis', 'Baseball'], eshop: ['sport'], kw: /\b(fifa|ea sports|fc ?2\d|nba ?2k|madden|nhl|pga tour|wwe ?2k|football manager|efootball|top spin)\b/i },
  { id: 'racing', label: 'Course', emoji: '🏎️', steam: ['Racing'], tags: ['Racing', 'Driving', 'Automobile Sim'], eshop: ['racing'], kw: /\b(racing|forza|need for speed|gran turismo|f1 ?2\d|nascar|motogp|wrc|rally)\b/i },
  { id: 'simulation', label: 'Simulation', emoji: '🚜', steam: ['Simulation'], tags: ['Simulation', 'Farming Sim', 'Life Sim', 'Job Simulator'], eshop: ['simulation'], kw: /\b(simulator|simulation)\b/i },
  { id: 'strategy', label: 'Stratégie', emoji: '♟️', steam: ['Strategy'], tags: ['Strategy', 'RTS', 'Turn-Based Strategy', 'Grand Strategy', '4X', 'Tower Defense'], eshop: ['strategy'] },
  { id: 'rpg', label: 'RPG', emoji: '🧙', steam: ['RPG'], tags: ['RPG', 'JRPG', 'CRPG', 'Action RPG'], eshop: ['rpg', 'role'] },
  { id: 'shooter', label: 'FPS / Tir', emoji: '🔫', tags: ['FPS', 'Shooter', 'Third-Person Shooter', 'Looter Shooter'], eshop: ['shooter'], kw: /\b(call of duty|battlefield|counter-strike)\b/i },
  { id: 'fighting', label: 'Combat', emoji: '🥊', tags: ['Fighting', '2D Fighter', '3D Fighter', "Beat 'em up"], eshop: ['fighting'], kw: /\b(tekken|street fighter|mortal kombat|smash bros)\b/i },
  { id: 'puzzle', label: 'Puzzle / Réflexion', emoji: '🧩', tags: ['Puzzle', 'Logic'], eshop: ['puzzle'] },
  { id: 'platformer', label: 'Plateforme', emoji: '🍄', tags: ['Platformer', '2D Platformer', '3D Platformer', 'Precision Platformer'], eshop: ['platform'] },
  { id: 'casual', label: 'Jeux occasionnels', emoji: '🎈', steam: ['Casual'], tags: ['Casual', 'Hidden Object', 'Clicker', 'Idler'], eshop: ['party'] },
  { id: 'visualnovel', label: 'Visual novel', emoji: '📖', tags: ['Visual Novel', 'Dating Sim', 'Otome'], kw: /\bvisual novel\b/i },
  { id: 'mmo', label: 'MMO / Free-to-play', emoji: '🌐', steam: ['Massively Multiplayer', 'Free to Play', 'Free To Play'], tags: ['MMORPG', 'Massively Multiplayer', 'Free to Play'] },
  { id: 'earlyaccess', label: 'Accès anticipé', emoji: '🚧', steam: ['Early Access'], tags: ['Early Access'] },
  { id: 'kids', label: 'Jeux pour enfants', emoji: '🧸', tags: ['Family Friendly', 'Education'], eshop: ['education'], kw: /\b(paw patrol|pat'? ?patrouille|peppa|bluey|barbie|gabby)\b/i },
];

export const GENRE_BY_ID = Object.fromEntries(GENRES.map((g) => [g.id, g]));

// Genres reconnus via les genres/avertissements officiels Steam (sans SteamSpy).
const STEAM_ONLY = new Set(['adult', 'earlyaccess', 'mmo', 'sport', 'racing', 'simulation', 'strategy', 'rpg', 'casual']);

// Faut-il interroger SteamSpy (tags) pour respecter les exclusions choisies ?
export const needsTags = (excluded = []) => excluded.some((id) => !STEAM_ONLY.has(id));

/**
 * Genres détectés pour un jeu ou un bon plan.
 * @param item     { title, steamAppID?, categories? }
 * @param appInfo  cache { [appid]: { genres, descriptors, tags } }
 */
export function genresOf(item, appInfo = {}) {
  const found = new Set();
  const info = item.steamAppID ? appInfo[item.steamAppID] : null;
  const cats = (item.categories || []).map((c) => String(c).toLowerCase());
  for (const g of GENRES) {
    if (info) {
      if (g.steam?.some((x) => info.genres?.includes(x))) found.add(g.id);
      if (g.descriptors?.some((x) => info.descriptors?.includes(x))) found.add(g.id);
      if (g.tags?.some((x) => info.tags?.includes(x))) found.add(g.id);
    }
    if (g.eshop && cats.some((c) => g.eshop.some((x) => c.includes(x)))) found.add(g.id);
    if (g.kw?.test(item.title || '')) found.add(g.id);
  }
  return found;
}
