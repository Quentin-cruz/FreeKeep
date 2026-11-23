// Genres que l'utilisateur peut exclure, et comment les reconnaître selon la source :
//  - descriptors : avertissements de contenu Steam (3 = contenu sexuel réservé aux adultes)
//    (pas 1 = « un peu de nudité », ni les tags joueurs « Nudity » / « Sexual Content » : ils visent aussi The Witcher 3, Cyberpunk 2077…)
//  - tags : identifiants des tags Steam (Horror = 1667…), seulement les plus votés du jeu
//  - eshop : catégories de l'eShop Nintendo
//  - kw : mots dans le titre (dernier recours, pour Epic, GOG, Dealabs…)
// « Plants vs. Zombies » (Plantes contre Zombies) n'est pas un jeu d'horreur : exclu du mot « zombies ».
export const GENRES = [
  // Uniquement le hentai et les jeux explicitement sexuels : jamais la violence, ni les jeux PEGI 18 (GTA, Red Dead, Call of Duty…)
  { id: 'adult', label: 'Hentai / sexe explicite', emoji: '🔞', descriptors: [3], tags: [9130, 24904], kw: /\b(hentai|nsfw|eroge|futanari)\b/i },
  { id: 'horror', label: 'Horreur', emoji: '👻', tags: [1667, 1721, 3978], eshop: ['horror'], kw: /\b(horror|horreur|(?<!plant(?:e?s) (?:vs\.?|versus|contre(?: les)?) )zombies?|resident evil|silent hill|outlast|amnesia|five nights)\b/i },
  { id: 'sport', label: 'Sport', emoji: '⚽', tags: [701, 1254546, 1746, 1254552, 7038, 5914, 5727], eshop: ['sport'], kw: /\b(fifa|ea sports|fc ?2\d|nba ?2k|madden|nhl|pga tour|wwe ?2k|football manager|efootball|top spin)\b/i },
  { id: 'racing', label: 'Course', emoji: '🏎️', tags: [699, 1644, 1100687], eshop: ['racing'], kw: /\b(racing|forza|need for speed|gran turismo|f1 ?2\d|nascar|motogp|wrc|rally)\b/i },
  { id: 'simulation', label: 'Simulation', emoji: '🚜', tags: [599, 87918, 10235, 35079], eshop: ['simulation'], kw: /\b(simulator|simulation)\b/i },
  { id: 'strategy', label: 'Stratégie', emoji: '♟️', tags: [9, 1676, 1741, 4364, 1670, 1645], eshop: ['strategy'] },
  { id: 'rpg', label: 'RPG', emoji: '🧙', tags: [122, 4434, 4474, 4231], eshop: ['rpg', 'role'] },
  { id: 'shooter', label: 'FPS / Tir', emoji: '🔫', tags: [1663, 1774, 3814, 353880], eshop: ['shooter'], kw: /\b(call of duty|battlefield|counter-strike)\b/i },
  { id: 'fighting', label: 'Combat', emoji: '🥊', tags: [1743, 4736, 6506, 4158], eshop: ['fighting'], kw: /\b(tekken|street fighter|mortal kombat|smash bros)\b/i },
  { id: 'puzzle', label: 'Puzzle / Réflexion', emoji: '🧩', tags: [1664, 6129], eshop: ['puzzle'] },
  { id: 'platformer', label: 'Plateforme', emoji: '🍄', tags: [1625, 5379, 5395, 3877], eshop: ['platform'] },
  { id: 'casual', label: 'Jeux occasionnels', emoji: '🎈', tags: [597, 1738, 379975, 615955], eshop: ['party'] },
  { id: 'visualnovel', label: 'Visual novel', emoji: '📖', tags: [3799, 9551, 31579], kw: /\bvisual novel\b/i },
  { id: 'mmo', label: 'MMO / Free-to-play', emoji: '🌐', tags: [1754, 128, 113] },
  { id: 'earlyaccess', label: 'Accès anticipé', emoji: '🚧', tags: [493] },
  { id: 'kids', label: 'Jeux pour enfants', emoji: '🧸', tags: [5350, 1036], eshop: ['education'], kw: /\b(paw patrol|pat'? ?patrouille|peppa|bluey|barbie|gabby)\b/i },
];

export const GENRE_BY_ID = Object.fromEntries(GENRES.map((g) => [g.id, g]));

// Nombre de tags regardés : au-delà, ils ne décrivent plus vraiment le jeu (« Racing » est le 12e tag de GTA V).
const MAIN_TAGS = 7;
const ADULT_TAGS = 12;

/**
 * Genres détectés pour un jeu ou un bon plan.
 * @param item     { title, steamAppID?, categories? }
 * @param appInfo  cache { [appid]: { descriptors, tags } }
 */
export function genresOf(item, appInfo = {}) {
  const found = new Set();
  const info = item.steamAppID ? appInfo[item.steamAppID] : null;
  const cats = (item.categories || []).map((c) => String(c).toLowerCase());
  for (const g of GENRES) {
    if (info) {
      if (g.descriptors?.some((x) => info.descriptors?.includes(x))) found.add(g.id);
      const top = (info.tags || []).slice(0, g.id === 'adult' ? ADULT_TAGS : MAIN_TAGS);
      if (g.tags?.some((x) => top.includes(x))) found.add(g.id);
    }
    if (g.eshop && cats.some((c) => g.eshop.some((x) => c.includes(x)))) found.add(g.id);
    if (g.kw?.test(item.title || '')) found.add(g.id);
  }
  return found;
}
