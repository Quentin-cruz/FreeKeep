import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEpic } from '../extension/src/sources/epic.js';
import { parseGamerPower, detectStore } from '../extension/src/sources/gamerpower.js';
import { parseSteamSearch } from '../extension/src/sources/steam.js';
import { mergeGames } from '../extension/src/merge.js';
import { cleanGamerPowerTitle, titlesMatch, parseUtc, formatDuration } from '../extension/src/util.js';
import { stateFor, patchState, keysForHistory } from '../extension/src/store.js';
import { epicFixture, gamerPowerFixture, steamSearchFixture } from './fixtures.js';

const now = Date.now();
const ALL = ['epic', 'steam', 'gog', 'ubisoft'];

test('Epic : jeux actifs, à venir, payants exclus', () => {
  const items = parseEpic(epicFixture(now), now);
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(items.length, 4);
  assert.equal(byTitle['Mark of the Deep'].status, 'active');
  assert.equal(byTitle['Mark of the Deep'].url, 'https://store.epicgames.com/fr/p/mark-of-the-deep-f7dc08');
  assert.equal(byTitle['Mark of the Deep'].worth, '19,99 €');
  assert.match(byTitle['Mark of the Deep'].images[0], /motd-wide\.jpg\?w=480/);
  assert.equal(byTitle['Hollow Lantern'].url, 'https://store.epicgames.com/fr/p/hollow-lantern');
  assert.equal(byTitle['Firestone – Idle Clicker Online RPG'].status, 'upcoming');
  assert.equal(byTitle['Mystery Game'].url, 'https://store.epicgames.com/fr/free-games');
  assert.ok(!byTitle['Paid Game On Sale']);
});

test('Epic : réponse invalide -> erreur', () => {
  assert.throws(() => parseEpic({ errors: [] }), /inattendue/);
});

test('GamerPower : stores, expirés, plateformes', () => {
  const items = parseGamerPower(gamerPowerFixture(now), ALL, now);
  const titles = items.map((i) => i.title).sort();
  assert.deepEqual(titles, ['Cozy Farm', 'Ghostrunner', 'Mark of the Deep', 'Neon Abyss', 'Rayman Origins', 'Shadow Tactics']);
  const gog = items.find((i) => i.title === 'Shadow Tactics');
  assert.equal(gog.store, 'gog');
  const ubi = items.find((i) => i.title === 'Rayman Origins');
  assert.equal(ubi.end, null);
  assert.equal(ubi.worth, null);
  assert.deepEqual(parseGamerPower({ status: 0, status_message: 'none' }, ALL), []);
  assert.equal(parseGamerPower(gamerPowerFixture(now), ['epic'], now).length, 1);
  assert.equal(detectStore('PC, DRM-Free, GOG'), 'gog');
  assert.equal(detectStore('PC, Epic Games Store'), 'epic');
});

test('Steam : seuls les -100 % sont retenus', () => {
  const items = parseSteamSearch(steamSearchFixture().results_html);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Cozy Farm™');
  assert.equal(items[0].appid, '555001');
  assert.equal(items[0].worth, '9,99€');
  assert.match(items[0].images[0], /555001\/header\.jpg$/);
  assert.equal(items[1].title, 'Retro Racer: Turbo & Nitro');
});

test('Titres : nettoyage et correspondance', () => {
  assert.equal(cleanGamerPowerTitle('Mark of the Deep (Epic Games) Giveaway'), 'Mark of the Deep');
  assert.equal(cleanGamerPowerTitle('Neon Abyss Steam Key Giveaway'), 'Neon Abyss');
  assert.equal(cleanGamerPowerTitle('Shadow Tactics (GOG) Giveaway'), 'Shadow Tactics');
  assert.ok(titlesMatch('Cozy Farm™', 'Cozy Farm'));
  assert.ok(titlesMatch('Firestone – Idle Clicker Online RPG', 'Firestone Online Idle Clicker RPG'));
  assert.ok(titlesMatch('Control', 'Control'));
  assert.ok(titlesMatch('Death Stranding', 'Death Stranding Director\'s Cut'));
  assert.ok(!titlesMatch('Hades', 'Hades II'));
  assert.ok(!titlesMatch('Far Cry 3', 'Far Cry 5'));
});

test('Fusion multi-sources sans doublons', () => {
  const epic = parseEpic(epicFixture(now), now);
  const steam = parseSteamSearch(steamSearchFixture().results_html);
  const gpw = parseGamerPower(gamerPowerFixture(now), ALL, now);
  const games = mergeGames([epic, steam, gpw], now);

  const motd = games.filter((g) => /mark of the deep/i.test(g.title));
  assert.equal(motd.length, 1, 'Mark of the Deep fusionné');
  assert.deepEqual(motd[0].sources, ['epic', 'gamerpower']);
  assert.equal(motd[0].url, 'https://store.epicgames.com/fr/p/mark-of-the-deep-f7dc08', 'URL officielle prioritaire');

  const cozy = games.find((g) => g.appid === '555001');
  assert.ok(cozy.end, 'date de fin complétée par GamerPower');
  assert.deepEqual(cozy.sources, ['steam', 'gamerpower']);
  assert.equal(cozy.keys.length, 1, 'même titre normalisé -> une seule clé');

  assert.equal(games.filter((g) => g.status === 'upcoming').length, 2);
  assert.equal(games[0].title, 'Hollow Lantern', 'tri : fin la plus proche en premier');
  assert.equal(games.length, 10);
});

test('Jeu à venir qui commence -> actif', () => {
  const later = now + 7 * 86400e3;
  const games = mergeGames([parseEpic(epicFixture(now), now)], later);
  const fs = games.find((g) => g.title.startsWith('Firestone'));
  assert.equal(fs.status, 'active');
});

test('États : clés multiples, historique', () => {
  const states = {};
  const game = { key: 'steam:cozy farm', keys: ['steam:cozy farm', 'steam:cozy farm x'], title: 'Cozy Farm', store: 'steam', url: 'u', images: ['a'] };
  patchState(states, game, { claimed: true, claimedAt: 1 });
  assert.equal(states['steam:cozy farm'].snapshot.title, 'Cozy Farm');
  assert.equal(states['steam:cozy farm x'].alias, 'steam:cozy farm');
  assert.ok(stateFor(states, { keys: ['steam:cozy farm x'] }).claimed);
  assert.deepEqual(keysForHistory(states, 'steam:cozy farm'), ['steam:cozy farm', 'steam:cozy farm x']);
  patchState(states, game, { claimed: false });
  assert.ok(!stateFor(states, game).claimed);
});

test('Utilitaires de date', () => {
  assert.equal(parseUtc('2026-11-27 23:59:59'), Date.UTC(2026, 10, 27, 23, 59, 59));
  assert.equal(parseUtc('N/A'), null);
  assert.equal(formatDuration(2 * 86400e3 + 5 * 3600e3), '2 j 5 h');
  assert.equal(formatDuration(5 * 3600e3 + 7 * 60e3), '5 h 07');
  assert.equal(formatDuration(30e3), '1 min');
});

// ===========================================================================
// v2 : giveaways élargis + bons plans
// ===========================================================================
import { DEFAULT_SETTINGS } from '../extension/src/config.js';
import { detectSite } from '../extension/src/sources/gamerpower.js';
import { parseCheapShark, applyHistoricLows } from '../extension/src/sources/cheapshark.js';
import { parseEshop, applyEshopPrices } from '../extension/src/sources/eshop.js';
import { parseRss, classifyDealabs, mergeDealabsItems, mentionsSwitch1 } from '../extension/src/sources/dealabs.js';
import { parseGgDeals, ggKeyshopDeals } from '../extension/src/sources/ggdeals.js';
import { buildDeals } from '../extension/src/deals.js';
import { parsePrice, titleContains } from '../extension/src/util.js';
import {
  cheapsharkAAAFixture, cheapsharkGemsFixture, cheapsharkGamesFixture, eshopSearchFixture, eshopNintendoFixture,
  eshopPriceFixture, dealabsFeeds, ggdealsFixture,
} from './fixtures.js';

const S = { ...DEFAULT_SETTINGS };
const ALL5 = ['epic', 'steam', 'gog', 'ubisoft', 'other'];

test('GamerPower : drops ponctuels (Alienware, itch.io), DLC exclus', () => {
  const items = parseGamerPower(gamerPowerFixture(now), ALL5, now);
  const ghost = items.find((i) => i.title === 'Ghostrunner');
  assert.equal(ghost.store, 'steam');
  assert.equal(ghost.via, 'Alienware Arena');
  const itch = items.find((i) => /Tiny Glade/.test(i.title));
  assert.equal(itch.store, 'other');
  assert.ok(!items.some((i) => /DLC/.test(i.title)), 'DLC exclu');
  assert.equal(detectSite({ instructions: 'Visit Fanatical and add to cart' }), 'Fanatical');
  assert.equal(parseGamerPower(gamerPowerFixture(now), ['epic', 'steam', 'gog', 'ubisoft'], now).some((i) => i.store === 'other'), false);
});

test('Prix et titres : utilitaires', () => {
  assert.equal(parsePrice('3,78€'), 3.78);
  assert.equal(parsePrice('1 299,99 €'), 1299.99);
  assert.equal(parsePrice('Gratuit'), 0);
  assert.equal(parsePrice(''), null);
  assert.ok(titleContains('Hollow Depths sur Nintendo Switch (Dématérialisé)', 'Hollow Depths'));
  assert.ok(!titleContains('Hades II (Steam)', 'Hades'));
  assert.ok(mentionsSwitch1('Metroid Prime 4 sur Nintendo Switch (39.17€ sur Switch 2)'));
  assert.ok(mentionsSwitch1('Mario & Luigi sur Nintendo Switch 1|2'));
  assert.ok(!mentionsSwitch1('Mario Kart World sur Nintendo Switch 2'));
});

test('CheapShark : gros jeux + pépites uniquement, meilleur store, plus bas historique', () => {
  const deals = parseCheapShark([...cheapsharkAAAFixture(), ...cheapsharkGemsFixture()], S);
  const titles = deals.map((d) => d.title).sort();
  assert.deepEqual(titles, ['Cozy Lighthouse', 'Mega Shooter 4', 'Space Saga Remastered']);
  const mega = deals.find((d) => d.title === 'Mega Shooter 4');
  assert.equal(mega.price, 9.89, 'store le moins cher gardé');
  assert.equal(mega.merchant, 'Steam');
  assert.equal(mega.discount, 84);
  assert.ok(mega.flags.aaa);
  assert.match(mega.url, /cheapshark\.com\/redirect\?dealID=deal1011%3D$/, 'dealID déjà encodé non ré-encodé');
  assert.ok(deals.find((d) => d.title === 'Cozy Lighthouse').flags.gem);
  applyHistoricLows(deals, cheapsharkGamesFixture());
  assert.ok(mega.flags.historicLow);
  assert.ok(!deals.find((d) => d.title === 'Space Saga Remastered').flags.historicLow);
  // seuil plus strict
  assert.equal(parseCheapShark(cheapsharkAAAFixture(), { ...S, pcMinDiscount: 80 }).length, 1);
});

test('eShop : pas de shovelware ni de Switch 2, jeux Nintendo dès -20 %, prix exacts', () => {
  const items = parseEshop([eshopSearchFixture(), eshopNintendoFixture()], S);
  const titles = items.map((i) => i.title);
  assert.ok(!titles.includes('Generic Shovelware 3000'));
  assert.ok(!titles.includes('Switch 2 Exclusive Racer'));
  assert.equal(titles[0], 'Super Plumber Odyssey', 'jeu Nintendo en tête');
  assert.match(items[0].url, /^https:\/\/www\.nintendo\.com\/fr-fr\/Jeux\//);
  applyEshopPrices(items, eshopPriceFixture(now));
  const dq = items.find((i) => i.title === 'Dragon Quest Saga XI');
  assert.equal(dq.price, 19.99);
  assert.ok(dq.end > now);
  assert.equal(items.find((i) => i.title === 'Sale Ended Adventure').onSale, false);
});

function dealabsItems(settings = S) {
  const feeds = dealabsFeeds(now);
  const raw = mergeDealabsItems(Object.entries(feeds).flatMap(([feed, xml]) => parseRss(xml).map((it) => ({ ...it, feed }))));
  return raw.map((it) => classifyDealabs(it, settings, now)).filter(Boolean);
}

test('Dealabs : lecture RSS', () => {
  const items = parseRss(dealabsFeeds(now).hot);
  assert.equal(items.length, 7);
  assert.equal(items[0].merchant, 'Amazon');
  assert.equal(items[0].priceText, '41,90€');
  assert.equal(items[0].category, 'Consoles & Jeux vidéo');
  assert.match(items[0].image, /100x100/);
});

test('Dealabs : tri physique / clés / erreur de prix / magasins locaux', () => {
  const items = dealabsItems();
  const byTitle = (re) => items.find((i) => re.test(i.title));
  assert.equal(items.length, 5, items.map((i) => i.title).join(' | '));
  const zelda = byTitle(/Zelda/);
  assert.equal(zelda.section, 'switch');
  assert.equal(zelda.channel, 'physical');
  assert.equal(zelda.price, 41.9);
  assert.match(zelda.images[0], /300x300/);
  assert.equal(byTitle(/SHINOBI/).channel, 'keyshop');
  assert.equal(byTitle(/SHINOBI/).section, 'pc');
  assert.ok(byTitle(/Elden/).flags.priceError, 'erreur de prix gardée même si pas hot');
  assert.ok(byTitle(/Kirby/).flags.local, 'magasin du 80 gardé');
  assert.ok(!byTitle(/Mario Party/), 'magasin du 83 écarté');
  assert.ok(!byTitle(/Mario Kart World/), 'Switch 2 seule écartée');
  assert.ok(!byTitle(/Joy-Con/), 'accessoire écarté');
  assert.ok(!byTitle(/Astro Bot/), 'PS5 écarté');
  assert.ok(!byTitle(/Montre/), 'hors jeux vidéo écarté');
  assert.ok(!byTitle(/Random Game/), 'pas hot -> écarté');
  assert.ok(!byTitle(/Old Deal/), 'trop vieux');
  assert.equal(dealabsItems({ ...S, dealabsOnlyHot: false }).length, 6);
  assert.equal(dealabsItems({ ...S, departments: '80, 83' }).length, 6);
});

test('GG.deals : prix clés + bons plans clés exceptionnels', () => {
  const prices = parseGgDeals(ggdealsFixture());
  assert.equal(prices['900101'].keyshop, 7.49);
  assert.ok(!prices['900102']);
  const keyDeals = ggKeyshopDeals(prices);
  const ow = keyDeals.find((d) => d.title === 'Open World Epic');
  assert.ok(ow.candidate && ow.flags.historicLow);
  assert.equal(ow.discount, 70);
  assert.ok(!keyDeals.find((d) => d.title === 'Mega Shooter 4').candidate);
  assert.throws(() => parseGgDeals({ success: false, data: { message: 'Too Many Requests' } }), /Too Many/);
});

test('buildDeals : fusion Dealabs ↔ eShop, prix clé, affaires exceptionnelles, chute soudaine', () => {
  const cs = parseCheapShark([...cheapsharkAAAFixture(), ...cheapsharkGemsFixture()], S);
  applyHistoricLows(cs, cheapsharkGamesFixture());
  const es = parseEshop([eshopSearchFixture(), eshopNintendoFixture()], S);
  applyEshopPrices(es, eshopPriceFixture(now));
  const gg = parseGgDeals(ggdealsFixture());
  const history = {};
  const lists = () => ({
    cheapshark: structuredClone(cs),
    eshop: structuredClone(es.filter((i) => i.onSale !== false)),
    dealabs: dealabsItems(),
    ggdeals: ggKeyshopDeals(gg),
  });
  const deals = buildDeals(lists(), history, gg, now);

  const sw = deals.filter((d) => d.section === 'switch');
  const pc = deals.filter((d) => d.section === 'pc');
  assert.equal(sw.length, 5, sw.map((d) => d.title).join(' | '));
  assert.equal(pc.length, 6, pc.map((d) => d.title).join(' | '));
  const hollow = sw.find((d) => d.title === 'Hollow Depths');
  assert.ok(hollow.flags.hot && hollow.dealabsUrl, 'deal eShop marqué hot grâce à Dealabs');
  assert.ok(!sw.some((d) => d.source === 'dealabs' && /Hollow/.test(d.title)), 'pas de doublon');
  assert.ok(hollow.exceptional);
  const mega = pc.find((d) => d.title === 'Mega Shooter 4');
  assert.equal(mega.keyshop.price, 7.49);
  assert.ok(mega.exceptional);
  assert.ok(pc.find((d) => /Elden/.test(d.title)).exceptional);
  assert.ok(!pc.find((d) => d.title === 'Space Saga Remastered').exceptional);
  assert.equal(deals[0].flags.priceError, true, 'erreur de prix en tête');

  // 2e vérification : le prix clé d'Open World Epic chute de 17,99 € à 8,99 €
  const gg2 = structuredClone(gg);
  gg2['900301'].keyshop = 8.99;
  const deals2 = buildDeals({ ...lists(), ggdeals: ggKeyshopDeals(gg2) }, history, gg2, now + 3 * 3600e3);
  const ow = deals2.find((d) => d.title === 'Open World Epic');
  assert.ok(ow.flags.drop && ow.exceptional);
  assert.equal(ow.prevPrice, 17.99);
});
