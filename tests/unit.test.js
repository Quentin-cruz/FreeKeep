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

const S = { ...DEFAULT_SETTINGS, departments: '80', switch: true };
const ALL5 = ['epic', 'steam', 'gog', 'ubisoft', 'ea', 'itch', 'indiegala', 'other'];

test('GamerPower : drops ponctuels (Alienware, itch.io), DLC exclus', () => {
  const items = parseGamerPower(gamerPowerFixture(now), ALL5, now);
  const ghost = items.find((i) => i.title === 'Ghostrunner');
  assert.equal(ghost.store, 'steam');
  assert.equal(ghost.via, 'Alienware Arena');
  const itch = items.find((i) => /Tiny Glade/.test(i.title));
  assert.equal(itch.store, 'itch');
  assert.ok(!items.some((i) => /DLC/.test(i.title)), 'DLC exclu');
  assert.equal(detectSite({ instructions: 'Visit Fanatical and add to cart' }), 'Fanatical');
  assert.equal(parseGamerPower(gamerPowerFixture(now), ['epic', 'steam', 'gog', 'ubisoft'], now).some((i) => i.store === 'itch'), false);
  assert.equal(detectStore('PC, DRM-Free', { instructions: 'Claim it on IndieGala' }), 'indiegala');
  assert.equal(detectStore('PC, Origin'), 'ea');
  assert.equal(detectStore('PC, Battle.net'), 'battlenet');
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


// ===========================================================================
// v3 : personnalisation
// ===========================================================================
import { effective, wants, bannedKeyword, sameGameStrict, extractGameName, makeOwnedIndex, hiddenReason } from '../extension/src/prefs.js';
import { genresOf, needsTags } from '../extension/src/genres.js';
import { parseSteamProfile, parseGamesXml } from '../extension/src/sources/steamlibrary.js';
import { parseAppDetails, parseSteamSpy } from '../extension/src/sources/steamapps.js';
import { platformOf } from '../extension/src/sources/cheapshark.js';
import { pcPlatformOf } from '../extension/src/sources/dealabs.js';
import { steamGamesXmlFixture } from './fixtures.js';

test('Niveaux d’exigence et sections actives', () => {
  assert.equal(effective({ ...DEFAULT_SETTINGS, level: 'strict' }).pcMinDiscount, 75);
  assert.equal(effective({ ...DEFAULT_SETTINGS, level: 'custom', pcMinDiscount: 55 }).pcMinDiscount, 55);
  assert.deepEqual(wants({ ...DEFAULT_SETTINGS }).sections, ['free', 'pc']);
  assert.deepEqual(wants({ ...DEFAULT_SETTINGS, switch: true }).sections, ['free', 'pc', 'switch']);
  assert.deepEqual(wants({ ...DEFAULT_SETTINGS, pc: false, switch: true }).sections, ['switch']);
  const noStore = { ...DEFAULT_SETTINGS, stores: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.stores).map((k) => [k, false])) };
  assert.deepEqual(wants(noStore).sections, []);
  assert.equal(wants({ ...DEFAULT_SETTINGS, stores: { ...DEFAULT_SETTINGS.stores, epic: false } }).upcoming, false);
});

test('Mots-clés bannis et jeux possédés (correspondance stricte)', () => {
  assert.equal(bannedKeyword('EA SPORTS FC 25 (Steam)', ['EA Sports FC']), 'EA Sports FC');
  assert.equal(bannedKeyword('Assassin’s Creed Mirage', ["Assassin's Creed"]), "Assassin's Creed");
  assert.equal(bannedKeyword('Fifty Shades', ['FIFA']), null);
  assert.equal(extractGameName('DOOM Eternal sur PC (Dématérialisé - Steam)'), 'DOOM Eternal');
  assert.ok(sameGameStrict('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt GOTY Edition'));
  assert.ok(!sameGameStrict('Hollow Knight', 'Hollow Knight Silksong'));
  assert.ok(!sameGameStrict('DOOM', 'DOOM Eternal'));
  const owned = makeOwnedIndex({ appids: ['900101'], names: ['DOOM', 'Celeste'] });
  assert.ok(owned.hasApp('900101'));
  assert.ok(owned.hasName('Celeste sur PC (Steam)'));
  assert.ok(!owned.hasName('DOOM Eternal sur PC (Steam)'));
});

test('Genres : Steam, SteamSpy, eShop et titre', () => {
  const appInfo = {
    1: { genres: ['Action', 'Sports'], descriptors: [], tags: [] },
    2: { genres: ['Indie'], descriptors: [3], tags: [] },
    3: { genres: ['Action'], descriptors: [], tags: ['Horror', 'Survival'] },
  };
  assert.ok(genresOf({ title: 'X', steamAppID: '1' }, appInfo).has('sport'));
  assert.ok(genresOf({ title: 'X', steamAppID: '2' }, appInfo).has('adult'));
  assert.ok(genresOf({ title: 'X', steamAppID: '3' }, appInfo).has('horror'));
  assert.ok(genresOf({ title: 'Kart', categories: ['racing', 'action'] }).has('racing'));
  assert.ok(genresOf({ title: 'Resident Evil 4 (Steam)' }).has('horror'));
  assert.ok(!genresOf({ title: 'Celeste' }).size);
  assert.equal(needsTags(['adult', 'sport']), false);
  assert.equal(needsTags(['horror']), true);
});

test('hiddenReason : mot-clé > genre > possédé ; la liste de souhaits ignore les genres', () => {
  const settings = { ...DEFAULT_SETTINGS, excludedGenres: ['horror'], bannedKeywords: ['FIFA'] };
  const owned = makeOwnedIndex({ appids: ['10'], names: [] });
  const appInfo = { 20: { genres: [], descriptors: [], tags: ['Horror'] } };
  assert.equal(hiddenReason({ title: 'FIFA 23', section: 'pc', flags: {} }, settings, { owned }), 'keyword:FIFA');
  assert.equal(hiddenReason({ title: 'Scary', steamAppID: '20', section: 'pc', flags: {} }, settings, { appInfo, owned }), 'genre:horror');
  assert.equal(hiddenReason({ title: 'Scary', steamAppID: '20', section: 'pc', flags: { wishlist: true } }, settings, { appInfo, owned }), null);
  assert.equal(hiddenReason({ title: 'Owned', steamAppID: '10', section: 'pc', flags: {} }, settings, { owned }), 'owned');
  assert.equal(hiddenReason({ title: 'Owned', steamAppID: '10', section: 'pc', flags: {} }, { ...settings, hideOwned: false }, { owned }), null);
});

test('Profil Steam : liens acceptés + lecture de la bibliothèque', () => {
  assert.deepEqual(parseSteamProfile('https://steamcommunity.com/id/quentin_80/'), { kind: 'id', id: 'quentin_80' });
  assert.deepEqual(parseSteamProfile('steamcommunity.com/profiles/76561198000000001/games/?tab=all'), { kind: 'profiles', id: '76561198000000001' });
  assert.deepEqual(parseSteamProfile('76561198000000001'), { kind: 'profiles', id: '76561198000000001' });
  assert.equal(parseSteamProfile('https://example.com/x'), null);
  const lib = parseGamesXml(steamGamesXmlFixture());
  assert.equal(lib.steamID64, '76561198000000001');
  assert.equal(lib.games.length, 3);
  assert.deepEqual(lib.games[0], { appid: '900101', name: 'Mega Shooter 4' });
  assert.throws(() => parseGamesXml('<?xml version="1.0"?><gamesList><error><![CDATA[This profile is private.]]></error></gamesList>'), /privé/);
  assert.throws(() => parseGamesXml('<html>login</html>'), /inattendue/);
});

test('Genres Steam : appdetails + SteamSpy', () => {
  const info = parseAppDetails('7', { 7: { success: true, data: { type: 'game', genres: [{ id: '1', description: 'Action' }], content_descriptors: { ids: [1, 5] } } } });
  assert.deepEqual(info, { type: 'game', genres: ['Action'], descriptors: [1, 5] });
  assert.ok(parseAppDetails('8', { 8: { success: false } }).failed);
  assert.deepEqual(parseSteamSpy({ tags: { Horror: 10, Indie: 500, Puzzle: 3 } }).slice(0, 2), ['Indie', 'Horror']);
  assert.deepEqual(parseSteamSpy({ tags: [] }), []);
});

test('Plateformes PC : CheapShark, Dealabs, filtre des stores', () => {
  assert.equal(platformOf({ storeID: '7', steamAppID: '1' }), 'gog');
  assert.equal(platformOf({ storeID: '15', steamAppID: '1' }), 'steam');
  assert.equal(platformOf({ storeID: '25', steamAppID: null }), 'epic');
  assert.equal(pcPlatformOf('Jeu X sur PC (Dématérialisé - Epic Games)'), 'epic');
  assert.equal(pcPlatformOf('Jeu X sur PC (Dématérialisé)'), null);
  // Sans Steam coché, un jeu vendu en clé Steam disparaît
  const noSteam = { ...S, stores: { ...S.stores, steam: false } };
  assert.equal(parseCheapShark([...cheapsharkAAAFixture(), ...cheapsharkGemsFixture()], noSteam).find((d) => d.title === 'Mega Shooter 4'), undefined);
  // GOG décoché : Space Saga (vendu chez GOG) disparaît
  const noGog = { ...S, stores: { ...S.stores, gog: false } };
  assert.equal(parseCheapShark(cheapsharkAAAFixture(), noGog).find((d) => d.title === 'Space Saga Remastered'), undefined);
});

test('Liste de souhaits : promo gardée dès -20 % même hors critères', () => {
  const wished = [{ ...cheapsharkGemsFixture()[2], salePrice: '3.49', normalPrice: '4.99', savings: '30' }];
  const deals = parseCheapShark([], S, { wished, wishlist: ['900203'] });
  assert.equal(deals.length, 1);
  assert.ok(deals[0].flags.wishlist);
});

test('Switch 2 : tri eShop et Dealabs selon le réglage', () => {
  const sw2 = { ...S, switch2: true };
  const items = parseEshop([eshopSearchFixture(), eshopNintendoFixture()], sw2);
  const racer = items.find((i) => i.title === 'Switch 2 Exclusive Racer');
  assert.equal(racer.platform, 'switch2');
  assert.equal(items.find((i) => i.title === 'Hollow Depths').platform, 'switch1');
  assert.ok(!parseEshop([eshopSearchFixture()], S).some((i) => i.platform === 'switch2'));
  const mk = dealabsItems(sw2).find((i) => /Mario Kart World/.test(i.title));
  assert.equal(mk.platform, 'switch2');
  assert.equal(dealabsItems(S).some((i) => /Mario Kart World/.test(i.title)), false);
});

test('Préférences de canaux : sans sites de clés / sans boîtes', () => {
  assert.equal(dealabsItems({ ...S, keyshops: false }).some((i) => i.channel === 'keyshop'), false);
  assert.equal(dealabsItems({ ...S, physical: false }).some((i) => i.channel === 'physical'), false);
});

// ---------- v4 : Amazon Prime, Microsoft Store, Battle.net, bibliothèque GOG ----------
import { isPrimeGiveaway } from '../extension/src/sources/gamerpower.js';
import { dealabsFreebie, freebieName } from '../extension/src/sources/dealabs.js';
import { showsGame } from '../extension/src/prefs.js';
import { parseGogUser, parseGogProducts } from '../extension/src/sources/goglibrary.js';

const gp = (over) => ({
  id: 1, title: 'X Giveaway', type: 'Game', status: 'Active', platforms: 'PC', end_date: 'N/A',
  published_date: '2026-11-01 10:00:00', open_giveaway_url: 'https://www.gamerpower.com/open/x', worth: '$9.99',
  description: '', instructions: '', image: 'i.jpg', ...over,
});

test('GamerPower : avantages Prime répartis par plateforme et réservés aux abonnés', () => {
  const data = [
    gp({ id: 1, title: 'Fallout 3 GOTY (Prime Gaming) Giveaway', platforms: 'PC, GOG', instructions: 'Claim it with Prime Gaming and redeem on GOG.' }),
    gp({ id: 2, title: 'Kingdom Come (Amazon Prime) Giveaway', platforms: 'PC, Epic Games Store' }),
    gp({ id: 3, title: 'Mystery Case Files (Prime Gaming) Giveaway', platforms: 'PC, DRM-Free', instructions: 'Redeem your code on Legacy Games.' }),
    gp({ id: 4, title: 'Star Wars Racer (Prime Gaming) Giveaway', platforms: 'PC, DRM-Free', instructions: 'Download it with the Amazon Games app.' }),
    gp({ id: 5, title: 'Diablo (Battle.net) Giveaway', platforms: 'PC, Battle.net' }),
  ];
  assert.ok(isPrimeGiveaway(data[0]));
  assert.ok(!isPrimeGiveaway(data[4]));
  const stores = ['epic', 'gog', 'amazon', 'legacy', 'battlenet'];
  const withPrime = parseGamerPower(data, stores, now, { prime: true });
  const by = Object.fromEntries(withPrime.map((i) => [i.title, i]));
  assert.equal(by['Fallout 3 GOTY'].store, 'gog');
  assert.equal(by['Kingdom Come'].store, 'epic');
  assert.equal(by['Mystery Case Files'].store, 'legacy');
  assert.equal(by['Star Wars Racer'].store, 'amazon');
  assert.equal(by['Diablo'].store, 'battlenet');
  assert.ok(by['Kingdom Come'].prime && !by['Diablo'].prime);
  // Sans Prime : seuls les jeux hors Prime restent
  assert.deepEqual(parseGamerPower(data, stores, now).map((i) => i.title), ['Diablo']);
  // Prime sur Epic visible seulement si Epic est coché
  assert.ok(!parseGamerPower(data, ['gog', 'amazon'], now, { prime: true }).some((i) => i.store === 'epic'));
});

test('Dealabs : jeux offerts → jeux gratuits (Prime, MS Store, Battle.net), pas les week-ends ni DLC', () => {
  const S2 = { stores: ['steam', 'epic', 'gog', 'microsoft', 'battlenet', 'amazon', 'legacy', 'luna'], prime: true };
  const fb = (title, merchant = '', s = S2) => dealabsFreebie({ title, link: 'https://www.dealabs.com/bons-plans/x-1234567', pubDate: now, merchant }, s, now);
  assert.equal(freebieName('Jeu Mafia offert sur PC (Dématérialisé - GOG)'), 'Mafia');
  assert.equal(fb('Jeu Diablo II offert sur Battle.net').store, 'battlenet');
  assert.equal(fb('Forza Horizon 4 offert sur Xbox PC / Microsoft Store').store, 'microsoft');
  assert.equal(fb('[Prime Gaming] Fallout 3 gratuit (Dématérialisé - Legacy Games)').store, 'legacy');
  const luna = fb('Jeux offerts sur Amazon Luna en cloud avec Prime : Fortnite, Sonic');
  assert.ok(luna.cloud && luna.store === 'luna');
  assert.equal(fb('Week-end gratuit sur Steam : Tekken 8'), null);
  assert.equal(fb('DLC gratuit pour Cyberpunk 2077 sur GOG'), null);
  assert.equal(fb('Jeu Halo offert sur Xbox Series X'), null);
  // Sans Prime ou plateforme non cochée → ignoré
  assert.equal(fb('[Prime Gaming] Fallout 3 gratuit (Legacy Games)', '', { ...S2, prime: false }), null);
  assert.equal(fb('Jeu Diablo II offert sur Battle.net', '', { ...S2, stores: ['steam'] }), null);
  // Un jeu offert ne reste pas dans les promos
  assert.equal(classifyDealabs({ title: 'Jeu Mafia offert sur PC (Dématérialisé - GOG)', link: 'x', pubDate: now, category: 'Jeux PC', feed: 'jeux', merchant: 'GOG', priceText: '0€', hot: true }, { ...DEFAULT_SETTINGS, dealabsOnlyHot: false }, now), null);
});

test('Préférences Prime : plateformes Prime seulement avec Prime ; Battle.net et MS Store', () => {
  const base = { ...DEFAULT_SETTINGS, onboarded: true };
  assert.ok(!wants(base).stores.includes('amazon'));
  assert.ok(wants({ ...base, prime: true }).stores.includes('amazon'));
  assert.ok(wants(base).stores.includes('battlenet') && wants(base).stores.includes('microsoft'));
  const w = wants(base);
  assert.ok(!showsGame({ store: 'epic', prime: true }, w));
  assert.ok(showsGame({ store: 'epic', prime: true }, wants({ ...base, prime: true })));
  assert.equal(platformOf({ storeID: '31' }), 'battlenet');
  assert.equal(pcPlatformOf('Overwatch Collection sur Battle.net'), 'battlenet');
});

test('Bibliothèque GOG : session, produits, jeux possédés masqués', () => {
  assert.throws(() => parseGogUser({ isLoggedIn: false }), /pas connecté/);
  assert.equal(parseGogUser({ isLoggedIn: true, username: 'quentin' }).username, 'quentin');
  const res = parseGogProducts({ totalPages: 2, products: [{ id: 1, title: 'The Witcher 3: Wild Hunt' }, { id: 2, title: 'Disco Elysium' }] });
  assert.equal(res.totalPages, 2);
  assert.equal(res.games.length, 2);
  const owned = makeOwnedIndex({}, { names: res.games.map((g) => g.title) });
  const settings = { ...DEFAULT_SETTINGS };
  assert.equal(hiddenReason({ title: 'Disco Elysium - The Final Cut', section: 'pc', steamAppID: '632470' }, settings, { owned }), 'owned'); // même jeu, autre édition
  assert.equal(hiddenReason({ title: 'The Witcher 2: Assassins of Kings', section: 'pc' }, settings, { owned }), null); // autre épisode
  assert.equal(hiddenReason({ title: 'Disco Elysium', section: 'pc', steamAppID: '632470' }, settings, { owned }), 'owned');
  assert.equal(hiddenReason({ title: 'Hades', section: 'pc' }, settings, { owned }), null);
});

// ===========================================================================
// v4.0.1 : réponses relevées sur les vrais sites
// ===========================================================================
import { parseSteamSession, parseProfileXml, fetchSteamLibrary } from '../extension/src/sources/steamlibrary.js';
import { isExceptional, scoreDeal } from '../extension/src/deals.js';
import { fetchEshop } from '../extension/src/sources/eshop.js';
import {
  steamUserDataFixture, steamUserDataLoggedOut, steamLoginPage, steamProfileXml, steamWishlistFixture,
  eshopRealFixture, dealabsTemperatureFeeds,
} from './fixtures.js';

// Remplace fetch le temps d'un test. `routes` : [morceau d'URL, réponse (texte ou objet)]
async function withFetch(routes, job) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), credentials: init.credentials });
    const hit = routes.find(([part]) => String(url).includes(part));
    if (!hit) return new Response('', { status: 404 });
    const body = typeof hit[1] === 'function' ? hit[1](String(url)) : hit[1];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body));
  };
  try {
    return { res: await job(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

test('Filtre adulte : The Witcher 3 et Cyberpunk restent visibles, HuniePop est masqué', () => {
  const appInfo = {
    292030: { genres: ['RPG'], descriptors: [1, 5], tags: ['Open World', 'RPG', 'Nudity'] },
    1086940: { genres: ['RPG'], descriptors: [1, 2, 5], tags: ['RPG', 'Sexual Content'] },
    339800: { genres: ['Indie'], descriptors: [1, 3, 5, 4], tags: ['Nudity', 'Sexual Content', 'Hentai'] },
  };
  assert.ok(!genresOf({ title: 'The Witcher 3', steamAppID: '292030' }, appInfo).has('adult'));
  assert.ok(!genresOf({ title: "Baldur's Gate 3", steamAppID: '1086940' }, appInfo).has('adult'));
  assert.ok(genresOf({ title: 'HuniePop', steamAppID: '339800' }, appInfo).has('adult'));
});

test('Dealabs : la température ne reste ni dans le titre, ni dans le nom du jeu offert', () => {
  const feeds = dealabsTemperatureFeeds(now);
  const raw = Object.entries(feeds).flatMap(([feed, xml]) => parseRss(xml).map((it) => ({ ...it, feed })));
  const items = mergeDealabsItems(raw);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.hot && !/°/.test(i.title)), items.map((i) => i.title).join(' | '));
  const free = items.find((i) => /Mafia/.test(i.title));
  assert.equal(dealabsFreebie(free, { stores: ['gog'] }, now).title, 'Mafia');
  // Annonce gardée en cache par une ancienne version
  const old = mergeDealabsItems([{ guid: 'x', title: '108° - Hades sur PC', feed: 'hot', hot: true }]);
  assert.equal(old[0].title, 'Hades sur PC');
  // Un titre qui commence par un nombre n'est pas touché
  assert.equal(mergeDealabsItems([{ guid: 'y', title: '7 Days to Die - PC', feed: 'jeux' }])[0].title, '7 Days to Die - PC');
});

test('eShop : les jeux connus passent, pas les inconnus bradés à -90 %', () => {
  const titles = (settings) => parseEshop([eshopRealFixture()], { ...S, switchMinDiscount: 40, ...settings }).map((i) => i.title);
  const got = titles();
  for (const t of ['nPaint', 'Piano: Learn and Play', 'nOS new Operating System', 'Cat Tales', 'Cannon Fodder and Green Game Bundle']) assert.ok(!got.includes(t), t);
  for (const t of ['The Elder Scrolls V: Skyrim®', 'DREDGE', 'Unicorn Overlord']) assert.ok(got.includes(t), t);
  assert.deepEqual(got.slice(0, 2), ['Metroid Dread', 'Xenoblade Chronicles: Definitive Edition'], 'jeux Nintendo devant');
  assert.ok(!got.includes('SPLIT FICTION'));
  assert.ok(titles({ switch2: true }).includes('SPLIT FICTION'));
});

test('eShop : seuls les jeux populaires déclenchent une alerte', () => {
  const deal = (rank, popular) => ({ source: 'eshop', section: 'switch', channel: 'eshop', discount: 90, normalPrice: 49.99, rank, flags: { popular, big: true } });
  assert.ok(isExceptional(deal(158, true)));
  assert.ok(!isExceptional(deal(1200, false)));
  assert.ok(scoreDeal(deal(158, true)) > scoreDeal(deal(1200, false)));
});

test('eShop : recherche par popularité et prix demandés par lots de 50', async () => {
  const docs = Array.from({ length: 70 }, (_, i) => ({
    title: `Jeu ${i}`, nsuid_txt: [`7001000000${1000 + i}`], price_regular_f: 29.99, price_discount_percentage_f: 50,
    downloads_rank_i: i + 1, publisher: 'Autre', playable_on_txt: ['HAC'],
  }));
  const prices = (url) => ({
    prices: new URL(url).searchParams.get('ids').split(',').map((id) => ({ title_id: Number(id), regular_price: { raw_value: '29.99' }, discount_price: { raw_value: '9.99' } })),
  });
  const { res, calls } = await withFetch(
    [['searching.nintendo', (u) => ({ response: u.includes('publisher') && u.includes('Nintendo+') ? { numFound: 0, docs: [] } : { numFound: 70, docs } })], ['/v1/price', prices]],
    () => fetchEshop({ ...S, switchMinDiscount: 40 }),
  );
  assert.equal(res.length, 70);
  assert.ok(res.every((i) => i.price === 9.99), 'prix exact pour tous, pas seulement les 50 premiers');
  const ids = calls.filter((c) => c.url.includes('/v1/price')).map((c) => new URL(c.url).searchParams.get('ids').split(',').length);
  assert.deepEqual(ids, [50, 20]);
  const first = new URL(calls[0].url).searchParams;
  assert.equal(first.get('sort'), 'downloads_rank_i asc');
  assert.match(first.get('fq'), /downloads_rank_i:\[1 TO 1500\]/);
});

test('eShop : promo sur le pack Deluxe quand le jeu seul ne l’est pas, jamais un pack de DLC', () => {
  const p = (id, regular, sale) => ({ title_id: Number(id), regular_price: { raw_value: String(regular) }, ...(sale ? { discount_price: { raw_value: String(sale) } } : {}) });
  const doc = (title, nsuids) => ({ title, nsuid_txt: nsuids, price_regular_f: 59.99, price_discount_percentage_f: 60, downloads_rank_i: 40, publisher: 'Autre', playable_on_txt: ['HAC'] });
  const items = parseEshop([{ response: { docs: [
    doc('Hogwarts Legacy', ['70070000019472', '70010000062277']),
    doc('Overcooked! 2', ['70010000000001', '70070000000001', '70070000000002']),
    doc('DLC en promo', ['70010000000002', '70070000000003', '70050000000003']),
    doc('Bundle seul', ['70070000000004']),
    doc('Jeu avec démo', ['70010000000006', '70010000000005']),
  ] } }], { ...S, switchMinDiscount: 40 });
  applyEshopPrices(items, { prices: [
    p('70070000019472', 69.99, 6.99), p('70010000062277', 59.99),
    p('70010000000001', 24.99, 6.24), p('70070000000001', 16.99, 5.77), p('70070000000002', 42.49, 14.44),
    p('70010000000002', 39.99), p('70070000000003', 11.99, 2.99), p('70050000000003', 9.99, 1.99),
    p('70070000000004', 44.99, 8.99),
    p('70010000000006', 0), p('70010000000005', 49.99, 29.99),
  ] });
  const get = (t) => items.find((i) => i.title === t);
  assert.equal(get('Hogwarts Legacy').price, 6.99);
  assert.equal(get('Hogwarts Legacy').discount, 90);
  assert.match(get('Hogwarts Legacy').merchant, /pack ou Deluxe/);
  assert.equal(get('Overcooked! 2').price, 6.24, 'le jeu seul, pas le pack de DLC moins cher');
  assert.equal(get('Overcooked! 2').merchant, 'Nintendo eShop');
  assert.equal(get('DLC en promo').onSale, false);
  assert.equal(get('Bundle seul').price, 8.99);
  assert.equal(get('Jeu avec démo').price, 29.99);
});

test('Steam : lecture de la session et de la fiche publique', () => {
  assert.throws(() => parseSteamSession(steamUserDataLoggedOut), /pas connecté/);
  assert.throws(() => parseSteamSession({}), /inattendue/);
  assert.deepEqual(parseSteamSession({ rgOwnedApps: [10, 20], rgWishlist: [30] }), { appids: ['10', '20'], wishlist: ['30'] });
  assert.deepEqual(parseProfileXml(steamProfileXml), { steamID64: '76561198000000001', profileName: 'TestProfile' });
  assert.throws(() => parseProfileXml('<response><error><![CDATA[The specified profile could not be found.]]></error></response>'), /introuvable/);
});

test('Bibliothèque Steam : session seule, avec profil, sans connexion', async () => {
  const session = { ...steamUserDataFixture, rgWishlist: [900102] };

  // Session seule, sans lien de profil
  const a = await withFetch([['dynamicstore/userdata', session]], () => fetchSteamLibrary({ useSession: true }));
  assert.deepEqual(a.res.appids, ['555002', '10', '20']);
  assert.deepEqual(a.res.wishlist, ['900102']);
  assert.equal(a.res.error, null);
  assert.equal(a.calls[0].credentials, 'include');

  // Session + profil, Steam renvoie quand même sa page de connexion : les jeux restent lus
  const b = await withFetch(
    [['dynamicstore/userdata', session], ['/games/', steamLoginPage], ['/?xml=1', steamProfileXml]],
    () => fetchSteamLibrary({ input: 'https://steamcommunity.com/id/test', useSession: true }),
  );
  assert.equal(b.res.appids.length, 3);
  assert.equal(b.res.profileName, 'TestProfile');
  assert.equal(b.res.error, null);

  // Session + profil lisible : les noms s'ajoutent
  const c = await withFetch(
    [['dynamicstore/userdata', session], ['/games/', steamGamesXmlFixture()], ['/?xml=1', steamProfileXml]],
    () => fetchSteamLibrary({ input: '76561198000000001', useSession: true }),
  );
  assert.ok(c.res.names.includes('Portal 2'));
  assert.ok(c.res.appids.includes('620') && c.res.appids.includes('10'));

  // Pas connecté : erreur claire, mais la liste de souhaits publique reste lue
  const d = await withFetch(
    [['dynamicstore/userdata', steamUserDataLoggedOut], ['/?xml=1', steamProfileXml], ['IWishlistService', steamWishlistFixture]],
    () => fetchSteamLibrary({ input: 'https://steamcommunity.com/id/test', useSession: true }),
  );
  assert.match(d.res.error, /pas connecté/);
  assert.deepEqual(d.res.wishlist, ['900102', '900203']);

  // Session désactivée : jamais de cookies Steam envoyés
  const e = await withFetch(
    [['/?xml=1', steamProfileXml], ['IWishlistService', steamWishlistFixture]],
    () => fetchSteamLibrary({ input: 'https://steamcommunity.com/id/test', useSession: false }),
  );
  assert.ok(e.calls.every((x) => x.credentials !== 'include'));
  assert.match(e.res.error, /session Steam/);
  assert.equal(e.res.wishlist.length, 2);
});
