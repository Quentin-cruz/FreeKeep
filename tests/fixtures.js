// Données de test calquées sur le format réel des API (dates relatives à "now").
const D = 86400e3;
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const gp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const epicPrice = (original, discountPrice) => ({
  totalPrice: {
    discountPrice,
    originalPrice: original,
    voucherDiscount: 0,
    discount: original - discountPrice,
    currencyCode: 'EUR',
    currencyInfo: { decimals: 2 },
    fmtPrice: {
      originalPrice: original ? `${(original / 100).toFixed(2).replace('.', ',')} €` : '0',
      discountPrice: discountPrice ? `${(discountPrice / 100).toFixed(2).replace('.', ',')} €` : '0',
      intermediatePrice: '0',
    },
  },
  lineOffers: [{ appliedRules: [] }],
});
const offer = (start, end, pct) => ({ startDate: iso(start), endDate: iso(end), discountSetting: { discountType: 'PERCENTAGE', discountPercentage: pct } });

export function epicFixture(now = Date.now()) {
  return {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              title: 'Mark of the Deep',
              id: '1f9a12b06b4f437790b6913ad136a08c',
              namespace: '3d6441ab9d4246208bc97d7babf664b5',
              description: 'Metroidvania de pirates sur une île maudite.',
              offerType: 'BASE_GAME',
              status: 'ACTIVE',
              productSlug: null,
              urlSlug: '2fd257a6cd80405a833f9004ff07993a',
              url: null,
              keyImages: [
                { type: 'OfferImageWide', url: 'https://cdn1.epicgames.com/test/motd-wide.jpg' },
                { type: 'Thumbnail', url: 'https://cdn1.epicgames.com/test/motd-thumb.jpg' },
              ],
              catalogNs: { mappings: [{ pageSlug: 'mark-of-the-deep-f7dc08', pageType: 'productHome' }] },
              offerMappings: [{ pageSlug: 'mark-of-the-deep-f7dc08', pageType: 'productHome' }],
              price: epicPrice(1999, 0),
              promotions: { promotionalOffers: [{ promotionalOffers: [offer(now - D, now + 6 * D, 0)] }], upcomingPromotionalOffers: [] },
            },
            {
              title: 'Hollow Lantern',
              offerType: 'BASE_GAME',
              productSlug: 'hollow-lantern',
              keyImages: [{ type: 'DieselStoreFrontWide', url: 'https://cdn1.epicgames.com/test/hl.jpg' }],
              catalogNs: { mappings: [] },
              offerMappings: [],
              price: epicPrice(2499, 0),
              promotions: { promotionalOffers: [{ promotionalOffers: [offer(now - 6 * D, now + 5 * H, 0)] }], upcomingPromotionalOffers: [] },
            },
            {
              title: 'Firestone – Idle Clicker Online RPG',
              offerType: 'BASE_GAME',
              productSlug: null,
              keyImages: [{ type: 'OfferImageWide', url: 'https://cdn1.epicgames.com/test/fs.jpg' }],
              catalogNs: { mappings: [{ pageSlug: 'firestone-online-idle-rpg-bfd04b', pageType: 'productHome' }] },
              offerMappings: [{ pageSlug: 'firestone-online-idle-rpg-bfd04b', pageType: 'productHome' }],
              price: epicPrice(0, 0),
              promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [offer(now + 6 * D, now + 13 * D, 0)] }] },
            },
            {
              title: 'Mystery Game',
              offerType: 'BASE_GAME',
              productSlug: '[]',
              keyImages: [],
              catalogNs: { mappings: [] },
              offerMappings: [],
              price: epicPrice(0, 0),
              promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [offer(now + 6 * D, now + 13 * D, 0)] }] },
            },
            {
              title: 'Paid Game On Sale',
              offerType: 'BASE_GAME',
              productSlug: 'paid-game',
              keyImages: [],
              price: epicPrice(1999, 1599),
              promotions: { promotionalOffers: [{ promotionalOffers: [offer(now - D, now + 6 * D, 80)] }], upcomingPromotionalOffers: [] },
            },
          ],
        },
      },
    },
  };
}

export function gamerPowerFixture(now = Date.now()) {
  const base = (id, title, platforms, end, extra = {}) => ({
    id,
    title,
    worth: '$9.99',
    thumbnail: `https://www.gamerpower.com/offers/1/${id}.jpg`,
    image: `https://www.gamerpower.com/offers/1b/${id}.jpg`,
    description: 'Giveaway description',
    instructions: '1. Click the button\n2. Claim',
    open_giveaway_url: `https://www.gamerpower.com/open/${id}`,
    published_date: gp(now - D),
    type: 'Game',
    platforms,
    end_date: end,
    users: 1200,
    status: 'Active',
    gamerpower_url: `https://www.gamerpower.com/giveaway-${id}`,
    open_giveaway: `https://www.gamerpower.com/open/${id}`,
    ...extra,
  });
  return [
    base(3001, 'Mark of the Deep (Epic Games) Giveaway', 'PC, Epic Games Store', gp(now + 6 * D), { worth: '$19.99' }),
    base(3002, 'Shadow Tactics (GOG) Giveaway', 'PC, DRM-Free, GOG', gp(now + 2 * D)),
    base(3003, 'Rayman Origins (Ubisoft) Giveaway', 'PC, Ubisoft', 'N/A', { worth: 'N/A' }),
    base(3004, 'Cozy Farm (Steam) Giveaway', 'PC, Steam', gp(now + 3 * D)),
    base(3005, 'Old Expired Game (Steam) Giveaway', 'PC, Steam', gp(now - D)),
    base(3006, 'Neon Abyss Steam Key Giveaway', 'PC, Steam', gp(now + 20 * H)),
    base(3007, 'Mobile Thing Giveaway', 'Android', gp(now + 3 * D)),
    base(3008, 'Expired Status (GOG) Giveaway', 'PC, GOG', gp(now + 3 * D), { status: 'Expired' }),
    base(3009, 'Ghostrunner (Steam) Key Giveaway', 'PC, Steam', gp(now + 4 * D), {
      instructions: '1. Login into your Alienware Arena account.\n2. Click the "Get Key" button.',
      worth: '$29.99',
    }),
    base(3010, 'Tiny Glade Demo Pack (Itch.io) Giveaway', 'PC, Itch.io', gp(now + 2 * D)),
    base(3011, 'Free DLC Pack Giveaway', 'PC, Steam', gp(now + 2 * D), { type: 'DLC' }),
  ];
}

export function steamSearchFixture() {
  const row = (appid, slug, title, discountBlock) => `
<a href="https://store.steampowered.com/app/${appid}/${slug}/?snr=1_7_7_2300_150_1" data-ds-appid="${appid}" data-ds-itemkey="App_${appid}" data-ds-tagids="[1,2]" data-search-page="1" class="search_result_row ds_collapse_flag" >
  <div class="col search_capsule"><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg?t=1700000000" srcset="x 1x" width="120" height="45"></div>
  <div class="responsive_search_name_combined">
    <div class="col search_name ellipsis"><span class="title">${title}</span><div><span class="platform_img win"></span></div></div>
    <div class="col search_released responsive_secondrow">1 janv. 2023</div>
    <div class="col search_price_discount_combined responsive_secondrow" data-price-final="${discountBlock.final}">
      ${discountBlock.html}
    </div>
  </div>
  <div style="clear: left;"></div>
</a>`;
  const modern = (pct, orig, final) => ({
    final,
    html: `<div class="discount_block search_discount_block" data-price-final="${final}" data-bundlediscount="0" data-discount="${pct}" role="link" aria-label="${pct}% de réduction"><div class="discount_pct">-${pct}%</div><div class="discount_prices"><div class="discount_original_price">${orig}</div><div class="discount_final_price">${final ? (final / 100).toFixed(2) + '€' : '0,00€'}</div></div></div>`,
  });
  const legacy = (pct, orig) => ({
    final: 0,
    html: `<div class="col search_discount responsive_secondrow"><span>-${pct}%</span></div><div class="col search_price discounted responsive_secondrow"><span style="color: #888888;"><strike>${orig}</strike></span><br>0,00€</div><div class="discount_pct">-${pct}%</div>`,
  });
  return {
    success: 1,
    results_html: [
      row(555001, 'Cozy_Farm', 'Cozy Farm&trade;', modern(100, '9,99€', 0)),
      row(555002, 'Retro_Racer', 'Retro Racer: Turbo &amp; Nitro', legacy(100, '4,99€')),
      row(555003, 'Half_Price', 'Half Price Hero', modern(50, '19,99€', 999)),
    ].join('\n'),
    total_count: 3,
    start: 0,
  };
}

export const steamUserDataFixture = { rgWishlist: [], rgOwnedPackages: [], rgOwnedApps: [555002, 10, 20] };

// ---------------------------------------------------------------------------
// Bons plans
// ---------------------------------------------------------------------------

const csDeal = (o) => ({
  internalName: o.title.toUpperCase().replace(/\W/g, ''),
  metacriticLink: null,
  dealID: o.dealID || `deal${o.gameID}${o.storeID || 1}%3D`,
  storeID: String(o.storeID || 1),
  gameID: String(o.gameID),
  salePrice: o.sale.toFixed(2),
  normalPrice: o.normal.toFixed(2),
  isOnSale: '1',
  savings: String((1 - o.sale / o.normal) * 100),
  metacriticScore: String(o.meta ?? 0),
  steamRatingText: o.steamText || 'Very Positive',
  steamRatingPercent: String(o.steam ?? 0),
  steamRatingCount: String(o.count ?? 0),
  steamAppID: o.appid ? String(o.appid) : null,
  releaseDate: 1500000000,
  lastChange: Math.floor(Date.now() / 1000) - 3600,
  dealRating: '9.5',
  thumb: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${o.appid}/capsule_sm_120.jpg`,
  title: o.title,
});

export function cheapsharkAAAFixture() {
  return [
    csDeal({ title: 'Mega Shooter 4', gameID: 101, appid: 900101, sale: 9.89, normal: 59.99, meta: 88, steam: 91, count: 85000 }),
    csDeal({ title: 'Mega Shooter 4', gameID: 101, appid: 900101, sale: 11.99, normal: 59.99, meta: 88, steam: 91, count: 85000, storeID: 15 }),
    csDeal({ title: 'Space Saga Remastered', gameID: 102, appid: 900102, sale: 14.99, normal: 39.99, meta: 81, steam: 77, count: 12000, storeID: 7 }),
    csDeal({ title: 'Broken Launch Simulator', gameID: 103, appid: 900103, sale: 5.99, normal: 49.99, meta: 52, steam: 41, count: 30000 }),
  ];
}

export function cheapsharkGemsFixture() {
  return [
    csDeal({ title: 'Cozy Lighthouse', gameID: 201, appid: 900201, sale: 2.99, normal: 14.99, steam: 97, count: 42000, storeID: 11 }),
    csDeal({ title: 'Tiny Unknown Gem', gameID: 202, appid: 900202, sale: 1.99, normal: 9.99, steam: 98, count: 400 }),
    csDeal({ title: 'Cheap Puzzle', gameID: 203, appid: 900203, sale: 0.99, normal: 4.99, steam: 95, count: 9000 }),
  ];
}

export function cheapsharkGamesFixture() {
  return {
    101: { info: { title: 'Mega Shooter 4' }, cheapestPriceEver: { price: '9.89', date: 1700000000 }, deals: [] },
    102: { info: { title: 'Space Saga Remastered' }, cheapestPriceEver: { price: '9.99', date: 1700000000 }, deals: [] },
    201: { info: { title: 'Cozy Lighthouse' }, cheapestPriceEver: { price: '2.99', date: 1700000000 }, deals: [] },
  };
}

export function cheapsharkPopularFixture() {
  return [csDeal({ title: 'Open World Epic', gameID: 301, appid: 900301, sale: 59.99, normal: 59.99, meta: 92, steam: 94, count: 300000 })];
}

const esDoc = (o) => ({
  title: o.title,
  url: `/fr-fr/Jeux/Jeux-Nintendo-Switch/${o.title.replace(/\W+/g, '-')}-${o.fs}.html`,
  nsuid_txt: [o.nsuid, '70070000000001'],
  fs_id: String(o.fs),
  price_regular_f: o.regular,
  price_lowest_f: Math.round(o.regular * (100 - o.discount)) / 100,
  price_discount_percentage_f: o.discount,
  image_url_h2x1_s: `https://www.nintendo.com/eu/media/images/10_share_images/${o.fs}.jpg`,
  image_url: `https://www.nintendo.com/eu/media/images/05_packshots/${o.fs}.jpg`,
  ...(o.rank != null ? { downloads_rank_i: o.rank } : {}),
  publisher: o.publisher || 'Indie Studio',
  playable_on_txt: o.playable || ['HAC'],
});

export function eshopSearchFixture() {
  return {
    responseHeader: { status: 0 },
    response: {
      numFound: 5,
      start: 0,
      docs: [
        esDoc({ title: 'Hollow Depths', fs: 5001, nsuid: '70010000050001', regular: 14.99, discount: 60, rank: 120 }),
        esDoc({ title: 'Dragon Quest Saga XI', fs: 5002, nsuid: '70010000050002', regular: 39.99, discount: 50, rank: 900, publisher: 'Square Enix' }),
        esDoc({ title: 'Generic Shovelware 3000', fs: 5003, nsuid: '70010000050003', regular: 4.99, discount: 90 }),
        esDoc({ title: 'Switch 2 Exclusive Racer', fs: 5004, nsuid: '70010000050004', regular: 69.99, discount: 50, rank: 10, playable: ['BEE'] }),
        esDoc({ title: 'Sale Ended Adventure', fs: 5006, nsuid: '70010000050006', regular: 29.99, discount: 50, rank: 50 }),
      ],
    },
  };
}

export function eshopNintendoFixture() {
  return {
    responseHeader: { status: 0 },
    response: {
      numFound: 1,
      start: 0,
      docs: [esDoc({ title: 'Super Plumber Odyssey', fs: 5005, nsuid: '70010000050005', regular: 59.99, discount: 33, rank: 3, publisher: 'Nintendo' })],
    },
  };
}

export function eshopPriceFixture(now = Date.now()) {
  const p = (id, regular, sale, endIn) => ({
    title_id: Number(id),
    sales_status: 'onsale',
    regular_price: { amount: `${regular.toFixed(2).replace('.', ',')} €`, currency: 'EUR', raw_value: regular.toFixed(2) },
    ...(sale != null
      ? { discount_price: { amount: `${sale.toFixed(2).replace('.', ',')} €`, currency: 'EUR', raw_value: sale.toFixed(2), start_datetime: iso(now - D), end_datetime: iso(now + endIn) } }
      : {}),
  });
  return {
    personalized: false,
    country: 'FR',
    prices: [
      p('70010000050001', 14.99, 5.99, 5 * D),
      p('70010000050002', 39.99, 19.99, 10 * H),
      p('70010000050005', 59.99, 39.99, 6 * D),
      p('70010000050006', 29.99, null),
    ],
  };
}

const rssItem = (o) => `
    <item>
      <title><![CDATA[${o.title}]]></title>
      <link>https://www.dealabs.com/bons-plans/${o.slug}-${o.id}</link>
      <guid isPermaLink="true">https://www.dealabs.com/bons-plans/${o.slug}-${o.id}</guid>
      <description><![CDATA[<p>${o.desc || 'Bon plan'}</p>]]></description>
      <category>${o.category || 'Consoles &amp; Jeux vidéo'}</category>
      <pubDate>${new Date(o.at).toUTCString()}</pubDate>
      <pepper:merchant name="${o.merchant}" price="${o.price}" />
      <media:content url="https://static-pepper.dealabs.com/threads/raw/abc/${o.id}_1/re/100x100/qt/60/${o.id}_1.jpg" width="100" height="100" />
    </item>`;

const rss = (title, items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:pepper="https://www.dealabs.com/rss/pepper">
  <channel>
    <title>${title}</title>
    <link>https://www.dealabs.com</link>${items.map(rssItem).join('')}
  </channel>
</rss>`;

export function dealabsFeeds(now = Date.now()) {
  const items = {
    zelda: { id: 3447401, slug: 'zelda-tears-of-the-kingdom', title: 'The Legend of Zelda : Tears of the Kingdom sur Nintendo Switch', merchant: 'Amazon', price: '41,90€', at: now - 5 * H },
    shinobi: { id: 3447407, slug: 'shinobi-art-of-vengeance', title: 'SHINOBI Art of Vengeance (Steam - Dématérialisé)', merchant: 'Eneba', price: '3,78€', at: now - 6 * H },
    error: { id: 3447500, slug: 'erreur-de-prix-elden', title: 'Elden Kingdom sur PC (Dématérialisé - Steam)', merchant: 'Fnac', price: '2,99€', desc: 'Probablement une erreur de prix, foncez !', at: now - 2 * H },
    local83: { id: 3447600, slug: 'mario-party', title: 'Mario Party Jamboree sur Nintendo Switch - Carrefour Puget-sur-Argens (83)', merchant: 'Carrefour', price: '19,99€', at: now - 3 * H },
    local80: { id: 3447601, slug: 'kirby', title: 'Kirby et le monde oublié sur Nintendo Switch - Leclerc Amiens (80)', merchant: 'E.Leclerc', price: '24,99€', at: now - 3 * H },
    sw2: { id: 3447700, slug: 'mario-kart-world', title: 'Mario Kart World sur Nintendo Switch 2', merchant: 'Fnac', price: '59,99€', at: now - 4 * H },
    joycon: { id: 3447701, slug: 'joy-con', title: 'Paire de manettes Joy-Con pour Nintendo Switch', merchant: 'Amazon', price: '59,99€', at: now - 4 * H },
    ps5: { id: 3447702, slug: 'astro-bot', title: 'Astro Bot sur PS5', merchant: 'Auchan', price: '39,99€', at: now - 4 * H },
    eshopTwin: { id: 3447703, slug: 'hollow-depths', title: 'Hollow Depths sur Nintendo Switch (Dématérialisé)', merchant: 'Nintendo eShop', price: '5,99€', at: now - 4 * H },
    cold: { id: 3447704, slug: 'random-game', title: 'Random Game sur PC (Dématérialisé - Steam)', merchant: 'Steam', price: '9,99€', at: now - 1 * H },
    old: { id: 3400000, slug: 'old-deal', title: 'Old Deal sur Nintendo Switch', merchant: 'Amazon', price: '9,99€', at: now - 20 * D },
    watch: { id: 3447800, slug: 'montre', title: 'Montre Seiko Presage', merchant: 'Amazon', price: '324€', category: 'Mode &amp; accessoires', at: now - 1 * H },
  };
  const { zelda, shinobi, error, local83, local80, sw2, joycon, ps5, eshopTwin, cold, old, watch } = items;
  return {
    hot: rss('Dealabs : Hot', [zelda, shinobi, local83, local80, sw2, eshopTwin, watch]),
    jeux: rss('Dealabs : Consoles & jeux vidéo', [shinobi, error, ps5, cold, joycon]),
    switch: rss('Dealabs : Jeux Nintendo Switch', [zelda, local83, local80, sw2, joycon, eshopTwin, old]),
  };
}

// Page « jeux Steam » d'Eneba : état Apollo intégré à la page.
export function enebaPcFixture() {
  const product = (id, name, cents, extra = {}) => ({
    [`Product:${id}`]: { __typename: 'Product', name, slug: `steam-${id}`, type: { value: extra.type || 'GAME' }, 'cheapestAuction({"currency":"EUR"})': { __ref: `Auction:${id}` } },
    [`Auction:${id}`]: { __typename: 'Auction', isInStock: extra.stock ?? true, 'price({"currency":"EUR"})': { amount: cents, currency: 'EUR' }, 'msrp({"currency":"EUR"})': { amount: 9999 } },
  });
  const state = {
    ...product('mega', 'Mega Shooter 4 (PC) Clé Steam EUROPE', 749),
    ...product('owe', 'Open World Epic Steam Key (PC) GLOBAL', 1799),
    ...product('us', 'Open World Epic Steam Key NORTH AMERICA', 999),
    ...product('pass', 'Open World Epic - Season Pass Steam Key GLOBAL', 499),
    ...product('gone', 'Indie Gem clé Steam GLOBAL', 199, { stock: false }),
    ...product('card', 'Steam Gift Card 20 EUR', 1900, { type: 'GIFTCARD' }),
  };
  return `<html><body><script id="__APOLLO_STATE__" type="application/json">${JSON.stringify(state)}</script></body></html>`;
}

// Page « PC Steam » d'Instant Gaming : prix dans un bloc JSON pour certains jeux, dans la carte pour les autres.
export function igPcFixture() {
  const card = (id, title, price) => `<article class="item"><a class="cover video" href="https://www.instant-gaming.com/fr/${id}-acheter-x/" title="acheter ${title}"><div class="discount">-50%</div></a>
    <div class="information"><span class="title" title="${title}">${title}</span>${price ? `<div class="
 price
 ">${price}&nbsp;€</div>` : ''}</div></article>`;
  return `<script>var x = [{"item_id":101,"price":"18.49","price_eur":"18.49"}];</script>
    ${card(101, 'Open World Epic - PC (Steam)')}
    ${card(102, 'Indie Gem - PC &amp; Mac (Steam)', '4.99')}
    ${card(103, 'Mega Shooter 4 - Xbox Series X|S', '5.00')}
    ${card(104, 'Open World Epic - PC (Steam) - US', '9.99')}`;
}

// Recherche du store Steam (api/storesearch), prix en centimes d'euro.
export function steamStoreSearchFixture(name) {
  const app = (id, n, initial, final = initial, metascore = '') => ({ type: 'app', name: n, id, price: { currency: 'EUR', initial, final }, metascore });
  const all = {
    'Mega Shooter 4': [app(900101, 'Mega Shooter 4', 989)],
    'Open World Epic': [app(900399, 'Open World Epic Soundtrack', 999), app(900301, 'Open World Epic™', 5999, 5999, '88')],
    'Indie Gem': [app(900500, 'Indie Gem', 1499, 549)],
  };
  return { total: (all[name] || []).length, items: all[name] || [] };
}

export function steamGamesXmlFixture() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<gamesList>
  <steamID64>76561198000000001</steamID64>
  <steamID><![CDATA[QuentinTest]]></steamID>
  <games>
    <game><appID>900101</appID><name><![CDATA[Mega Shooter 4]]></name><logo><![CDATA[https://x/logo.jpg]]></logo></game>
    <game><appID>555002</appID><name><![CDATA[Retro Racer: Turbo & Nitro]]></name></game>
    <game><appID>620</appID><name><![CDATA[Portal 2]]></name></game>
  </games>
</gamesList>`;
}

export const steamWishlistFixture = { response: { items: [{ appid: 900102, priority: 1, date_added: 1700000000 }, { appid: 900203, priority: 2, date_added: 1700000000 }] } };

export function steamAppDetailsFixture(appid) {
  const genres = {
    900102: [{ id: '1', description: 'Action' }, { id: '28', description: 'Simulation' }],
    900201: [{ id: '4', description: 'Casual' }],
    900301: [{ id: '1', description: 'Action' }, { id: '3', description: 'RPG' }],
  }[appid] || [{ id: '1', description: 'Action' }];
  return { [appid]: { success: true, data: { type: 'game', name: `App ${appid}`, genres, content_descriptors: { ids: [] } } } };
}

// ---------- v0.3 : Prime, Battle.net, bibliothèque GOG (utilisés par le test de bout en bout) ----------
export function gamerPowerPrimeExtras(now = Date.now()) {
  const g = (id, title, platforms, instructions) => ({
    id, title, worth: '$19.99', thumbnail: `https://www.gamerpower.com/offers/1/${id}.jpg`, image: `https://www.gamerpower.com/offers/1b/${id}.jpg`,
    description: 'Free for Prime members.', instructions, open_giveaway_url: `https://www.gamerpower.com/open/${id}`,
    published_date: gp(now - D), type: 'Game', platforms, end_date: gp(now + 9 * D), status: 'Active', gamerpower_url: `https://www.gamerpower.com/x-${id}`,
  });
  return [
    g(3101, 'Kingdom Quest (Prime Gaming) Giveaway', 'PC, Epic Games Store', 'Claim it on Amazon Luna with Prime, then redeem on Epic Games.'),
    g(3102, 'Pixel Pirates (Prime Gaming) Giveaway', 'PC, DRM-Free', 'Claim with Prime and download it with the Amazon Games app.'),
  ];
}

export function dealabsFreebiesXml(now = Date.now()) {
  return [
    { id: 3449001, slug: 'diablo-classic', title: 'Jeu Diablo Classic offert sur PC (Dématérialisé - Battle.net)', merchant: 'Battle.net', price: '0€', at: now - 2 * H },
    { id: 3449002, slug: 'mystery-manor', title: '[Prime Gaming] Mystery Manor gratuit (Dématérialisé - Legacy Games)', merchant: 'Amazon', price: '0€', at: now - 3 * H },
    { id: 3449003, slug: 'luna-cloud', title: 'Jeux offerts sur Amazon Luna en cloud avec Prime : Sonic, Tetris', merchant: 'Amazon', price: '0€', at: now - 3 * H },
    { id: 3449004, slug: 'week-end', title: 'Week-end gratuit sur Steam : Tekken 8', merchant: 'Steam', price: '0€', at: now - 1 * H },
  ].map(rssItem).join('');
}

export const gogUserFixture = { isLoggedIn: true, username: 'quentin_gog' };
export const gogProductsFixture = {
  totalPages: 1,
  totalProducts: 2,
  products: [{ id: 1207658691, title: 'Shadow Tactics' }, { id: 1207658692, title: 'SHINOBI Art of Vengeance' }],
};

// ---------- Réponses relevées sur les vrais sites (novembre 2026) ----------

// Steam sans connexion : les listes existent mais sont vides.
export const steamUserDataLoggedOut = { rgWishlist: [], rgOwnedPackages: [], rgOwnedApps: [], rgFollowedApps: [] };

// steamcommunity.com/id/…/games/?xml=1 sans connexion : page de connexion en HTML.
export const steamLoginPage = '<!DOCTYPE html><html lang="en" class="responsive DesktopUI"><head><title>Sign In</title></head><body></body></html>';

export const steamProfileXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
	<steamID64>76561198000000001</steamID64>
	<steamID><![CDATA[TestProfile]]></steamID>
	<onlineState>offline</onlineState>
</profile>`;

// eShop : titre, prix normal, remise, rang de téléchargement, éditeur, support.
export function eshopRealFixture() {
  const rows = [
    ['nPaint', 19.99, 90, 9163], ['Piano: Learn and Play', 19.99, 90, 8894], ['nOS new Operating System', 39.99, 95, 7221],
    ['Cat Tales', 19.99, 90, 999999], ['Cannon Fodder and Green Game Bundle', 11.99, 83, undefined],
    ['LEGO® City Undercover', 59.99, 92, 365], ['The Elder Scrolls V: Skyrim®', 59.99, 67, 158], ['DREDGE', 24.99, 60, 437],
    ['Unicorn Overlord', 59.98, 70, 1200], ['SPLIT FICTION', 49.99, 40, 93, 'EA', 'BEE'],
    ['Metroid Dread', 59.99, 33, 184, 'Nintendo'], ['Xenoblade Chronicles: Definitive Edition', 59.99, 33, 913, 'Nintendo'],
  ];
  return {
    response: {
      numFound: rows.length,
      docs: rows.map(([title, regular, discount, rank, publisher = 'Autre', playable = 'HAC'], i) => ({
        title, url: '/fr-fr/Jeux/x.html', nsuid_txt: [`700100000000${10 + i}`], price_regular_f: regular,
        price_discount_percentage_f: discount, ...(rank === undefined ? {} : { downloads_rank_i: rank }), publisher, playable_on_txt: [playable],
      })),
    },
  };
}

// Dealabs : le même deal dans « hot » (préfixé par la température) et dans un groupe (titre normal).
export function dealabsTemperatureFeeds(now = Date.now()) {
  const moon = { id: 3463442, slug: 'moonlighter', merchant: 'Nintendo', price: '4,34€', at: now - 2 * H };
  const title = 'Moonlighter: Complete Edition sur Nintendo Switch (Dématérialisé)';
  const free = { id: 3463500, slug: 'mafia', title: '412° - Jeu Mafia offert sur PC (Dématérialisé - GOG)', merchant: 'GOG', price: '0€', at: now - H };
  return {
    hot: rss('Dealabs : Hot', [{ ...moon, title: `119° - ${title}` }, free]),
    switch: rss('Dealabs : Jeux Nintendo Switch', [{ ...moon, title }]),
  };
}

// NEXARDA : /api/v3/find?steam=… puis /api/v3/prices?type=game&id=…&currency=EUR
export function nexardaFindFixture(appid) {
  const known = { 900101: 11, 900301: 31 };
  return known[appid]
    ? { success: true, code: 'game_found', message: 'Here is the video game info.', game: { id: known[appid], name: 'x' } }
    : { success: false, code: 'game_not_found', message: 'No video game found with the given Steam App ID.' };
}
export function nexardaPricesFixture(id) {
  const offer = (store, type, price, o = {}) => ({
    url: `https://nexarda.co/plg/${id}${store.length}${Math.round(price * 100)}?currency=EUR`,
    store: { name: store, type, official: type === 'Official Store' },
    edition: o.edition || 'Standard Edition', region: o.region || 'Global', platform: o.platform || 'Steam',
    available: o.available ?? true, price, discount: 0,
    coupon: o.code ? { available: true, discount: 10, code: o.code, price_without: price * 1.1 } : { available: false, discount: 0, code: '', price_without: price },
  });
  const lists = {
    11: [offer('Steam', 'Official Store', 9.89), offer('Gamivo', 'Marketplace', 6.49, { code: 'NEXARDA10' }), offer('Kinguin', 'Marketplace', 6.99)],
    31: [
      offer('Steam', 'Official Store', 29.99),
      offer('Amazon', 'Marketplace', 5), // objets physiques : écarté
      offer('G2A', 'Marketplace', 7.5, { region: 'North America' }), // autre région : écartée
      offer('K4G', 'Marketplace', 8, { edition: 'Deluxe Edition' }), // autre édition
      offer('Eneba', 'Marketplace', 9, { available: false }),
      offer('HRK Game', 'Key Seller', 12.4),
      offer('Instant Gaming', 'Key Seller', 13.1),
    ],
  };
  return { success: true, code: 'game_prices_found', prices: { currency: 'EUR', list: lists[id] || [] } };
}
