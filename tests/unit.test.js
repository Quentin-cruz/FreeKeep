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
// v0.1 : giveaways élargis + bons plans
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
// v0.2 : personnalisation
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
  assert.deepEqual(wants({ ...DEFAULT_SETTINGS }).sections, ['free', 'pc', 'bundle']);
  assert.deepEqual(wants({ ...DEFAULT_SETTINGS, switch: true }).sections, ['free', 'pc', 'bundle', 'switch']);
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

// ---------- v0.3 : Amazon Prime, Microsoft Store, Battle.net, bibliothèque GOG ----------
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
// v0.3.1 : réponses relevées sur les vrais sites
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

test('Filtre horreur : Plants vs. Zombies reste visible, les autres jeux de zombies sont masqués', () => {
  const horror = (title) => genresOf({ title }).has('horror');
  for (const t of ['Plants vs. Zombies™: Replanted', 'Plants vs. Zombies™ : La Bataille de Neighborville Édition Intégrale', 'Plants vs Zombies GOTY Edition', 'Plantes contre Zombies', 'Plantes contre les zombies', 'PLANTS VS. ZOMBIES Garden Warfare 2 sur PC']) assert.ok(!horror(t), t);
  for (const t of ['Zombie Army 4: Dead War', 'Yet Another Zombie Survivors', 'Call of Duty Zombies', 'Golf VS Zombies', 'Zombie Garden vs Plants Defence', 'Resident Evil 4', 'Plants vs. Zombies + Outlast']) assert.ok(horror(t), t);
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

// ===========================================================================
// v1.1 : launchers, jeux en boîte, départements, filtre adulte
// ===========================================================================
import { localDepartments, parseDepartments } from '../extension/src/sources/dealabs.js';
import { pickSteamApp, resolveSteamIds } from '../extension/src/sources/steamsearch.js';
import { enrichAppInfo } from '../extension/src/sources/steamapps.js';
import { fetchCheapShark } from '../extension/src/sources/cheapshark.js';
import { INTERVALS, LEVELS } from '../extension/src/config.js';
import { KEYWORD_SUGGESTIONS } from '../extension/ui/components.js';

test('Départements : titres réels Dealabs', () => {
  const cases = [
    ['Saros sur PS5 - Auchan Villenave-d’Ornon (33)', ['33']],
    ['Console Nintendo Switch 2 Zelda (batterie amovible) - Cultura Toulouse Gramont (31) (console uniquement)', ['31']],
    ['Console Nintendo Switch 2 (Via 89.80€ sur la carte de fidélité) - Dainville (62) / Templeuve (59) en BA / Rouffiac (31)', ['62', '59', '31']],
    ['Jeu X sur Nintendo Switch - Carrefour (59/62)', ['59', '62']],
    ['Jeu X sur Nintendo Switch - Leclerc Ajaccio (2A)', ['2A']],
    ['Jeu X sur Nintendo Switch - Saint-Denis (974)', ['974']],
    ['Zelda sur Nintendo Switch 2 (via 12,87€ en bon d’achat sur l’app) - Sézanne (51)', ['51']],
    ['The Last Ninja Collection - Édition Limitée (7 jeux rétro sur cartouche) - Amazon / E.Leclerc', []],
    ['Cyberpunk 2077: Ultimate Edition sur Nintendo Switch 2', []],
    ['Jeu EA FC 27 sur Nintendo Switch 2 (+ 10€ fidélité pour les adhérents)', []],
    ['FIFA 23 sur Nintendo Switch (2022)', []],
    ['Console (Via 46,90€ sur carte de fidélité - sélection de magasins)', []],
  ];
  for (const [title, want] of cases) assert.deepEqual(localDepartments(title), want, title);
  assert.deepEqual(parseDepartments('80, 60'), ['80', '60']);
  assert.deepEqual(parseDepartments('1 ; 2a/974'), ['01', '2A', '974']);
  assert.deepEqual(parseDepartments('80000'), ['80']);
  assert.deepEqual(parseDepartments('97410'), ['974']);
  assert.deepEqual(parseDepartments('20'), ['2A', '2B']);
  assert.deepEqual(parseDepartments('Somme, 99'), []);
});

test('Jeux en boîte : nationaux et locaux à égalité, sans exiger « hot »', () => {
  const st = { ...DEFAULT_SETTINGS, switch: true, switch2: true, departments: '80' };
  const deal = (title, merchant, extra = {}, settings = st) => classifyDealabs({ title, merchant, link: 'https://www.dealabs.com/bons-plans/x-1234567', guid: title, pubDate: now, category: 'Consoles & Jeux vidéo', priceText: '24,99€', feed: 'switch', ...extra }, settings, now);
  const national = deal('Hollow Knight sur Nintendo Switch', 'Amazon');
  const local = deal('Kirby sur Nintendo Switch - Leclerc Amiens (80)', 'E.Leclerc');
  assert.equal(national.channel, 'physical');
  assert.equal(national.merchant, 'Amazon');
  assert.equal(local.channel, 'physical');
  assert.equal(scoreDeal(national), scoreDeal(local));
  assert.equal(deal('High on Life 2 sur Nintendo Switch 2', 'Amazon').platform, 'switch2');
  assert.equal(deal('Jeu Nintendo Switch The Last Ninja Collection - Amazon / E.Leclerc', '').merchant, 'Amazon');
  // Ailleurs : écarté, même si le département n'est pas à la fin du titre
  assert.equal(deal('Kirby sur Nintendo Switch - Cultura Toulouse (31) (retrait uniquement)', 'Cultura'), null);
  // Plusieurs magasins dont un chez toi : gardé
  assert.ok(deal('Kirby sur Nintendo Switch - Lille (59) / Amiens (80)', 'Auchan').flags.local);
  // Sites de clés et eShop : « hot » toujours exigé
  assert.equal(deal('Persona 5 Royal sur Nintendo Switch (Dématérialisé)', 'Driffle'), null);
  assert.equal(deal('Moonlighter sur Nintendo Switch (Dématérialisé)', 'Nintendo'), null);
  // Niveau « Que les affaires de fou » : « hot » exigé partout
  const strict = { ...st, level: 'strict', ...LEVELS.strict };
  assert.equal(deal('Hollow Knight sur Nintendo Switch', 'Amazon', {}, strict), null);
  assert.ok(deal('Hollow Knight sur Nintendo Switch', 'Amazon', { hot: true }, strict));
  // Jeux en boîte désactivés
  assert.equal(deal('Hollow Knight sur Nintendo Switch', 'Amazon', {}, { ...st, physical: false }), null);
  // Accessoires et consoles toujours écartés
  assert.equal(deal('Console Nintendo Switch 2 + Mario Kart World', 'Amazon'), null);
});

test('Dealabs : groupe « erreur de prix », jeux vidéo seulement', () => {
  const st = { ...DEFAULT_SETTINGS };
  const it = (title, category, feed) => ({ guid: title, title, category, feed, merchant: 'Fanatical', priceText: '10,79€', link: 'https://www.dealabs.com/bons-plans/x-1234567', pubDate: now });
  const [game] = mergeDealabsItems([it('Helldivers 2 sur PC (Dématérialisé - Steam)', 'Consoles & Jeux vidéo', 'erreur')]);
  assert.ok(classifyDealabs(game, st, now).flags.priceError);
  const [tv] = mergeDealabsItems([it('TV LG OLED sur PC', 'High-Tech', 'erreur')]);
  assert.equal(classifyDealabs(tv, st, now), null);
  // Vu dans le groupe « erreur » ET dans « jeux » : le signalement est gardé
  const [both] = mergeDealabsItems([it('Helldivers 2 sur PC (Dématérialisé - Steam)', 'Consoles & Jeux vidéo', 'erreur'), it('Helldivers 2 sur PC (Dématérialisé - Steam)', 'Consoles & Jeux vidéo', 'jeux')]);
  assert.ok(both.priceError && both.feed === 'jeux');
});

test('Dealabs : launcher d’après le magasin', () => {
  assert.equal(pcPlatformOf('Road 96 sur Xbox One & PC (Dématérialisé)', 'Xbox Store'), 'microsoft');
  assert.equal(pcPlatformOf('Sélection de jeux EA sur PC', 'EA'), 'ea');
  assert.equal(pcPlatformOf('Metro Exodus sur PC (Dématérialisé)', 'Steam'), 'steam');
  assert.equal(pcPlatformOf('Jeu sur PC (Dématérialisé - Steam)', 'Xbox Store'), 'steam');
});

test('CheapShark : une offre par launcher choisi', async () => {
  const d = (storeID, salePrice, dealID) => ({ gameID: '1', title: 'Control', storeID, salePrice, normalPrice: '39.99', savings: String(100 - (salePrice / 39.99) * 100), metacriticScore: '85', steamRatingPercent: '90', steamRatingCount: '9000', steamAppID: '870780', dealID });
  const raw = [d('1', '5.99', 'a'), d('7', '6.99', 'b'), d('25', '7.99', 'c'), d('7', '6.49', 'e')];
  const [item] = parseCheapShark(raw, { ...S, stores: { steam: true, gog: true, epic: true } });
  assert.equal(item.platform, 'steam');
  assert.equal(item.price, 5.99);
  assert.deepEqual(Object.keys(item.offers).sort(), ['epic', 'gog', 'steam']);
  assert.equal(item.offers.gog.price, 6.49);
  assert.match(item.offers.epic.merchant, /Epic/);
  // Launcher non choisi : pas d'offre
  const [only] = parseCheapShark(raw, { ...S, stores: { gog: true } });
  assert.equal(only.platform, 'gog');
  assert.deepEqual(Object.keys(only.offers), ['gog']);
  // Seuls les stores choisis sont interrogés
  const asked = async (stores) => {
    const { calls } = await withFetch([['/deals', []], ['/games', {}]], () => fetchCheapShark({ ...S, stores }));
    return calls.map((c) => new URL(c.url).searchParams.get('storeID')).filter(Boolean).sort();
  };
  assert.deepEqual([...new Set(await asked({ steam: true, gog: true, epic: true }))], ['25'], 'GOG a sa propre source');
  assert.deepEqual(await asked({ steam: true }), []);
});

test('Filtre adulte : hentai et sexe explicite, jamais les PEGI 18', async () => {
  const info = (descriptors, tags = [], genres = ['Action']) => ({ 1: { genres, descriptors, tags } });
  const adult = (descriptors, tags, genres) => genresOf({ title: 'X', steamAppID: '1' }, info(descriptors, tags, genres)).has('adult');
  // Avertissements relevés sur Steam : GTA V, Red Dead 2, Call of Duty, Cyberpunk, KCD2, Outlast, Mortal Kombat 11, DOA6
  for (const d of [[1, 2, 5], [5], [2, 5], [1, 5], []]) assert.ok(!adult(d, ['Nudity', 'Sexual Content', 'Mature', 'Violent']), d.join());
  assert.ok(!adult([1, 2, 4, 5], ['Nudity', 'Mature']), 'nudité fréquente sans sexe explicite');
  assert.ok(!adult([], [], ['Nudity', 'Sexual Content']));
  assert.ok(adult([1, 3, 4, 5]), 'HuniePop, Being a DIK, Subverse');
  assert.ok(adult([1, 5], ['Hentai', 'Anime']), 'Miss Neko');
  for (const t of ['Grand Theft Auto V', 'Red Dead Redemption 2', 'Call of Duty: Black Ops (PEGI 18+)', 'Uncensored War']) assert.ok(!genresOf({ title: t }).has('adult'), t);
  assert.ok(genresOf({ title: 'Hentai Puzzle' }).has('adult'));
  // Les tags ne sont demandés que pour les jeux signalés « nudité ou sexe »
  const details = (id, ids) => ({ [id]: { success: true, data: { type: 'game', genres: [], content_descriptors: { ids } } } });
  const cache = {};
  const { calls } = await withFetch(
    [['appids=1', details(1, [1, 5])], ['appids=2', details(2, [2, 5])], ['steamspy', { tags: { Hentai: 50 } }]],
    () => enrichAppInfo(['1', '2'], cache, { adult: true, now }),
  );
  assert.deepEqual(calls.filter((c) => c.url.includes('steamspy')).map((c) => new URL(c.url).searchParams.get('appid')), ['1']);
  assert.ok(genresOf({ title: 'X', steamAppID: '1' }, cache).has('adult'));
  assert.ok(!genresOf({ title: 'X', steamAppID: '2' }, cache).has('adult'));
});

test('Annonces Dealabs : jeu possédé reconnu par son nom sur Steam', async () => {
  const found = { items: [{ type: 'app', name: 'Battlefield™ 2042', id: 1517290 }, { type: 'app', name: 'Battlefield™ 6', id: 2807960 }] };
  assert.equal(pickSteamApp(found, 'Battlefield 2042 Élite'), null, 'édition inconnue : on ne devine pas');
  assert.equal(pickSteamApp(found, 'Battlefield 2042'), '1517290');
  const deal = () => ({ section: 'pc', source: 'dealabs', title: 'Battlefield 2042 sur PC (Dématérialisé - Steam)' });
  const cache = {};
  const first = deal();
  const a = await withFetch([['storesearch', found]], () => resolveSteamIds([first, { section: 'switch', title: 'Zelda' }, { section: 'pc', steamAppID: '5', title: 'Y' }], cache, now));
  assert.equal(a.calls.length, 1);
  assert.equal(first.steamAppID, '1517290');
  const owned = makeOwnedIndex({ appids: ['1517290'] });
  assert.equal(hiddenReason(first, { ...DEFAULT_SETTINGS }, { owned }), 'owned');
  // En cache : aucune nouvelle requête
  const again = deal();
  const b = await withFetch([], () => resolveSteamIds([again], cache, now));
  assert.equal(b.calls.length, 0);
  assert.equal(again.steamAppID, '1517290');
});

test('Licences à bannir : LEGO masque tous les jeux LEGO, suggestions à jour', () => {
  for (const t of ['LEGO® City Undercover', 'LEGO® Star Wars™ : La Saga Skywalker', 'The LEGO Games Bundle', 'La Grande Aventure LEGO 2 : Le Jeu Vidéo']) assert.equal(bannedKeyword(t, ['LEGO']), 'LEGO', t);
  assert.equal(bannedKeyword('Legolas Adventure', ['LEGO']), null);
  assert.ok(['LEGO', 'Mortal Kombat', 'Hogwarts Legacy'].every((k) => KEYWORD_SUGGESTIONS.includes(k)));
  assert.ok(!KEYWORD_SUGGESTIONS.some((k) => /fifa|five nights/i.test(k)));
});

test('Fréquences : dès 5 minutes', () => {
  const minutes = INTERVALS.map(([v]) => Math.round(v * 60));
  assert.deepEqual(minutes.slice(0, 4), [5, 10, 15, 30]);
  assert.ok(INTERVALS.some(([v]) => v === DEFAULT_SETTINGS.intervalHours));
});

test('Dealabs : jeu Prime reconnu même si Prime n’est cité que dans la description', () => {
  const find = (description, prime, title = 'Jeu Mafia offert sur PC (Dématérialisé - GOG)', merchant = 'GOG') =>
    dealabsFreebie({ title, merchant, description, link: 'https://www.dealabs.com/bons-plans/x-1234567', pubDate: now }, { stores: ['gog', 'epic', 'amazon'], prime }, now);
  const reserved = [
    'Offert aux membres Amazon Prime via Prime Gaming.',
    'Le jeu est offert aux abonnés Prime, clé à activer sur GOG.',
    'Avec votre abonnement Amazon Prime, récupérez le jeu.',
    'À récupérer sur <a href="https://luna.amazon.com/claims/mafia">cette page</a>.',
    'Lien : <a href="https://gaming.amazon.com/mafia">ici</a>',
    'Réservé aux clients Prime',
    'Nécessite Amazon Prime',
  ];
  for (const text of reserved) {
    assert.equal(find(text, false), null, text);
    const got = find(text, true);
    assert.equal(got?.prime, true, text);
    assert.equal(got.store, 'gog', 'activé sur GOG');
    assert.equal(got.via, 'Amazon Prime');
  }
  // Prime cité sans que le jeu lui soit réservé : toujours visible, sans badge Prime
  const open = [
    '', 'Jeu offert par GOG pendant 72 h.',
    'Offert à tous, sans abonnement Amazon Prime.',
    'Pas besoin d’être membre Prime pour en profiter.',
    'Aucun abonnement Prime requis.',
    'Optimus Prime est jouable dans ce jeu.',
    'Metroid Prime sera aussi en promo.',
    'Déjà offert sur Prime Gaming en 2024, cette fois pour tout le monde.',
    'La série est à voir avec Prime Video.',
  ];
  for (const text of open) {
    const got = find(text, false);
    assert.equal(got?.title, 'Mafia', text);
    assert.equal(got.prime, false, text);
  }
});

test('Dealabs : faux jeux PC gratuits écartés (titres réels), vrais jeux gardés', () => {
  const st = { ...DEFAULT_SETTINGS, prime: true, dealabsOnlyHot: true };
  const stores = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'battlenet', 'microsoft', 'itch', 'amazon'];
  const item = (title, merchant, priceText = '') => ({ guid: title, title, merchant, priceText, description: '', category: 'Consoles & Jeux vidéo', feed: 'jeux', hot: true, link: 'https://www.dealabs.com/bons-plans/x-1234567', pubDate: now });
  const free = (t, m) => dealabsFreebie(item(t, m), { stores, prime: true }, now);
  const deal = (t, m, p) => classifyDealabs(item(t, m, p), st, now);

  const fake = [
    ['Lonesome Village gratuit sur Android / iOS (Dématérialisé)', 'Epic Games Store'],
    ['Chants of Sennaar Gratuit sur Android et iOS (Dématérialisé)', 'Epic Games Store'],
    ['Morpion Jumbo Pro gratuit sur Android (Dématérialisé - Play Store)', 'Google Play'],
    ['[Twitch Drops] Grand Theft Auto VI - Badges GTA 6 offerts en visionnant 6h de stream (Dématérialisé)', 'Prime Gaming'],
    ['World of Warships - Yūbari Pack gratuit sur PC (Dématérialisé)', 'Xbox Store'],
    ['Starter Pack offert pour Warframe sur PC (Dématérialisé - Steam)', 'Steam'],
    ['Emote Mini Pekka offerte sur PC (Dématérialisé - Steam)', 'Steam'],
    ['[Possesseurs Final Fantasy XIV] 30 Jours de Jeu gratuit pour FFXIV Online sur PC (Steam)', 'Square Enix'],
    // déjà écartés avant, et à ne pas retrouver dans les promos
    ['Crusader Kings III Jouable Gratuitement jusqu’au 23 novembre sur PC (Dématérialisé - Steam)', 'Steam'],
    ['Payday 3 jouable gratuitement sur PC jusqu’au 9/11/2026 (Dématérialisé)', 'Steam'],
    ['Legacy - Reawakening sur PC devient Free-to-play (Dématérialisé - Steam)', 'Steam'],
    ['Essai Gratuit du mode DMZ de Call of Duty: Modern Warfare 4 sur PC, Xbox & PS5 (Dématérialisé)', 'Steam'],
  ];
  for (const [t, m] of fake) {
    assert.equal(free(t, m), null, `gratuit : ${t}`);
    assert.equal(deal(t, m), null, `promo : ${t}`);
  }

  const real = [
    ['Bread and Fred Gratuit sur PC (Dématérialisé)', 'Epic Games Store', 'epic', 'Bread and Fred'],
    ['The Ghost Of Solaris gratuit sur PC (Dématérialisé)', 'Steam', 'steam', 'The Ghost Of Solaris'],
    ['Contractor: The Clean Up Part II Gratuit sur PC (Dématérialisé)', 'Epic Games Store', 'epic', 'Contractor: The Clean Up Part II'],
    ['Mark of the Deep Gratuit sur PC (Dématérialisé)', 'Epic Games Store', 'epic', 'Mark of the Deep'],
    ['Knightica Gratuit sur PC, Android et iOS (Dématérialisé)', 'Epic Games Store', 'epic', 'Knightica'],
    ['Fallout: New Vegas gratuit sur PC (Dématérialisé - Steam)', 'Lenovo', 'steam', 'Fallout: New Vegas'],
    ["Letter Quest: Grimm's Journey Remastered gratuit sur PC (Dématérialisé - Steam)", 'Fanatical', 'steam', "Letter Quest: Grimm's Journey Remastered"],
    ['Epic World - Hunt For Quest gratuit sur PC (Dématérialisé)', 'Epic Games Store', 'epic', 'Epic World - Hunt For Quest'],
    ['The Jackbox Party Pack 2 gratuit sur PC (Dématérialisé - Steam)', 'Steam', 'steam', 'The Jackbox Party Pack 2'],
    ['Avatar: Frontiers of Pandora offert sur PC (Dématérialisé)', 'Ubisoft Store', 'ubisoft', 'Avatar: Frontiers of Pandora'],
    ['Streamer Life Simulator gratuit sur PC (Dématérialisé - Steam)', 'Steam', 'steam', 'Streamer Life Simulator'],
  ];
  for (const [t, m, store, name] of real) {
    const got = free(t, m);
    assert.equal(got?.store, store, t);
    assert.equal(got.title, name);
    assert.equal(deal(t, m), null, `pas en double dans les promos : ${t}`);
  }

  // Une vraie promo payante qui contient « offert » ou « gratuit » reste une promo
  assert.equal(deal('Metro Exodus sur PC + extension offerte (Dématérialisé - Steam)', 'Steam', '2,99€').price, 2.99);
  assert.equal(deal('Forza Horizon 6 sur PC + poster offert (Dématérialisé - Steam)', 'Steam', '52,49€').price, 52.49);
  assert.equal(dealabsFreebie(item('Forza Horizon 6 sur PC + poster offert (Dématérialisé - Steam)', 'Steam', '52,49€'), { stores, prime: true }, now), null);
  assert.equal(deal('Hollow Knight sur Nintendo Switch (livraison gratuite)', 'Amazon', '24,99€').channel, 'physical');
});

// ===========================================================================
// v1.2 : euros, nouvelles sources, licences, souhaits
// ===========================================================================
import { parseEcbRate, toEur, worthInEur } from '../extension/src/sources/rates.js';
import { parseSteamItems, wishlistDeals } from '../extension/src/sources/steamstore.js';
import { parseGog } from '../extension/src/sources/gog.js';
import { parseEa } from '../extension/src/sources/ea.js';
import { parseBarter, fanaticalTiers, humbleTiers, buildBundles } from '../extension/src/sources/bundles.js';
import { parseKeyName, parseEneba, parseKinguin, parseInstantGaming, buildKeyDeals } from '../extension/src/sources/switchkeys.js';
import { parseDealabsPage } from '../extension/src/sources/dealabspages.js';
import { applyEuros, mergeLaunchers } from '../extension/src/deals.js';
import { steamOnly } from '../extension/src/prefs.js';

test('Licences bannies : orthographes proches et variantes réelles', () => {
  const hit = [
    ['EA SPORTS FC™ 27', 'EA Sports FC'], ['Jeu EA FC 27 sur Nintendo Switch 2 (+ 10€ fidélité pour les adhérents)', 'EA Sports FC'],
    ['FC 27 sur Nintendo switch', 'EA Sports FC'], ['FC26 sur Nintendo Switch 2 (via de 12,5€ de fidélité)', 'ea sports fc'], ['FIFA 23 Legacy Edition', 'EA Sports FC'],
    ['NBA 2K26 sur Nintendo Switch 2', 'NBA 2K'], ['NBA 2K27 sur Nintendo Switch', 'nba 2k'], ['NBA2K26', 'NBA 2K'], ['NBA 2K 24 Kobe Bryant Edition', 'NBA2K'],
    ['Hogwarts Legacy', "Hogwart's Legacy"], ["Hogwart's Legacy", 'Hogwarts Legacy'], ['Hogwart Legacy', 'Hogwarts Legacy'], ['Hogwarts Legcay', 'Hogwarts Legacy'],
    ['Hogwarts Legacy : L’Héritage de Poudlard', 'Hogwarts Legacy'], ['L’Héritage de Poudlard', 'hogwarts legacy'],
    ['Assassins Creed Odyssey', "Assassin's Creed"], ['Assassin’s Creed: The Ezio Collection', 'Assassins Creed'],
    ['Call of Duty®: Modern Warfare', 'call of duty'], ['The Sims 4', 'Les Sims'], ['LEGO® City Undercover', 'lego'], ['Mortal Kombat 1', 'Mortal Kombat'], ['Mortal Combat 11', 'Mortal Kombat'],
    ['Battlefield 2042', 'Battlefeild'], ['Farming Simulator 26', 'Farming Simulator'],
  ];
  for (const [t, k] of hit) assert.equal(bannedKeyword(t, [k]), k, `${t} / ${k}`);
  const miss = [
    ['Legolas Adventure', 'LEGO'], ['Lego', 'Les Sims'], ['Batman: Arkham Knight', 'Battlefield'], ['Fortnite', 'FIFA'], ['NBA Jam', 'NBA 2K'], ['WWE 2K25', 'NBA 2K'],
    ['Hades II', 'Hogwarts Legacy'], ['Legacy of Kain', 'Hogwarts Legacy'], ['Combat Mission', 'Mortal Kombat'], ['Call of Juarez', 'Call of Duty'], ['Resident Evil 4', 'Battlefield'], ['Simulacra', 'Les Sims'],
    ['Farming Life', 'Farming Simulator'], ['Creed: Rise to Glory', "Assassin's Creed"], ['Half-Life 2', 'EA Sports FC'],
  ];
  for (const [t, k] of miss) assert.equal(bannedKeyword(t, [k]), null, `${t} / ${k}`);
});

test('Prix en euros : taux BCE, prix Steam exacts, conversion signalée', () => {
  assert.ok(Math.abs(parseEcbRate("<Cube currency='USD' rate='1.10'/>") - 1 / 1.1) < 1e-9);
  assert.throws(() => parseEcbRate('<html>'), /illisible/);
  assert.equal(toEur(10, 0.9), 9);
  assert.match(worthInEur('$19.99', 0.9), /^≈ 17,99\s€$/);
  assert.equal(worthInEur('19,50 €', 0.9), '19,50 €');

  const steam = parseSteamItems({ response: { store_items: [
    { appid: 10, success: 1, type: 0, name: 'Jeu A', reviews: { summary_filtered: { percent_positive: 92, review_count: 5000 } }, best_purchase_option: { final_price_in_cents: '299', original_price_in_cents: '5999', discount_pct: 95, active_discounts: [{ discount_end_date: 1796320800 }] } },
    { appid: 11, success: 1, type: 4, name: 'DLC' }, { appid: 12, success: 8 },
  ] } });
  assert.deepEqual(Object.keys(steam), ['10', '11']);
  assert.equal(steam[10].price, 2.99);
  assert.equal(steam[10].end, 1796320800000);

  const offer = (price, normalPrice, merchant) => ({ price, normalPrice, discount: 90, merchant, url: 'x', currency: 'USD' });
  const item = (offers) => ({ steamAppID: '10', section: 'pc', platform: 'steam', title: 'Jeu A', price: 1, currency: 'USD', flags: {}, offers });
  // Steam moins cher que le revendeur : prix officiel, sans « ≈ »
  const [a] = applyEuros([item({ steam: offer(4, 59.99, 'GameBillet'), epic: offer(6, 59.99, 'Epic Games Store') })], steam, 0.9);
  assert.equal(a.price, 2.99);
  assert.equal(a.merchant, 'Steam');
  assert.equal(a.approx, false);
  assert.equal(a.offers.epic.price, 5.4);
  assert.equal(a.offers.epic.approx, true);
  // Revendeur moins cher : prix converti, remise calculée sur le vrai prix Steam
  const [b] = applyEuros([item({ steam: offer(2, 59.99, 'GameBillet') })], steam, 0.9);
  assert.equal(b.price, 1.8);
  assert.equal(b.approx, true);
  assert.equal(b.normalPrice, 59.99);
  assert.equal(b.discount, 97);
  for (const d of [a, b]) for (const o of Object.values(d.offers)) assert.equal(o.currency, 'EUR');
  // Passer du dollar à l'euro n'est pas une « chute soudaine »
  const hist = { 'cs:1': { price: 10, currency: 'USD', at: now - 3600e3 } };
  const [deal] = buildDeals({ cheapshark: [{ id: 'cs:1', section: 'pc', channel: 'official', title: 'Z', price: 6, currency: 'EUR', flags: {} }] }, hist, {}, now);
  assert.ok(!deal.flags.drop);
});

test('GOG et EA : promos officielles en euros', () => {
  const p = (id, title, final, base, rating, count, currency = 'EUR') => ({ id, title, slug: 's', storeLink: `https://www.gog.com/fr/game/${id}`, coverHorizontal: 'https://img', price: { finalMoney: { amount: String(final), currency }, baseMoney: { amount: String(base) } }, reviewsRating: rating, reviewsCount: count, genres: [{ slug: 'strategy' }] });
  const gog = parseGog([p(1, 'Sleeping Dogs', 2.99, 19.99, 46, 2000), p(2, 'Mal noté', 1, 19.99, 30, 900), p(3, 'Trop petit', 0.49, 4.99, 48, 900), p(4, 'Peu remisé', 15, 19.99, 48, 900), p(5, 'En dollars', 2, 19.99, 48, 900, 'USD'), { ...p(6, 'Mafia Trilogy', 5, 59.99, 48, 900), productType: 'pack' }], { ...DEFAULT_SETTINGS });
  assert.deepEqual(gog.map((d) => d.title), ['Sleeping Dogs']);
  assert.equal(gog[0].currency, 'EUR');
  assert.equal(gog[0].platform, 'gog');
  assert.ok(genresOf(gog[0]).has('strategy'));

  const game = (slug, title, total, sale) => ({ slug, title, isFreeToPlay: false, packArt: { ar16X9: 'https://img' }, price: { displayTotal: total, displayTotalWithDiscount: sale, discountPercentage: 50, currency: 'EUR' }, genres: [{ slug: 'sports' }] });
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { deals: [game('bf', 'Battlefield\n 1', '39,99 €', '1,99 €'), game('x', 'Peu remisé', '39,99 €', '34,99 €'), game('bf', 'Battlefield 1', '39,99 €', '1,99 €')] } })}</script>`;
  const ea = parseEa(html, { ...DEFAULT_SETTINGS });
  assert.equal(ea.length, 1);
  assert.equal(ea[0].title, 'Battlefield 1');
  assert.equal(ea[0].price, 1.99);
  assert.equal(ea[0].platform, 'ea');
  assert.throws(() => parseEa('<html>', DEFAULT_SETTINGS), /inattendue/);
});

test('Launchers : une carte par jeu, un prix par launcher', () => {
  const base = { section: 'pc', channel: 'official', currency: 'EUR', flags: {} };
  const cs = { ...base, id: 'cs:1', title: 'Metro Exodus', steamAppID: '412020', platform: 'steam', price: 3, offers: { steam: { price: 3, merchant: 'Steam' } } };
  const gog = { ...base, id: 'gog:1', title: 'Metro Exodus', platform: 'gog', price: 2.5, merchant: 'GOG', url: 'g' };
  const other = { ...base, id: 'gog:2', title: 'Sleeping Dogs', platform: 'gog', price: 3, merchant: 'GOG', url: 'g' };
  const out = mergeLaunchers([cs], [gog, other]);
  assert.equal(out.length, 2);
  assert.equal(out[0].platform, 'gog', 'le moins cher en premier');
  assert.equal(out[0].offers.steam.price, 3);
  assert.deepEqual(Object.keys(out[1].offers), ['gog']);
});

test('Souhait Steam : proposé sur Steam seulement', () => {
  const offers = { steam: { price: 5, merchant: 'Steam' }, gog: { price: 3, merchant: 'GOG' } };
  const both = steamOnly({ section: 'pc', channel: 'official', platform: 'gog', price: 3, offers });
  assert.equal(both.platform, 'steam');
  assert.equal(both.price, 5);
  assert.deepEqual(Object.keys(both.offers), ['steam']);
  assert.equal(steamOnly({ section: 'pc', channel: 'official', platform: 'gog', price: 3, offers: { gog: offers.gog } }).hiddenBy, 'wishlist');
  assert.equal(steamOnly({ section: 'pc', channel: 'official', platform: 'ea', price: 3 }).hiddenBy, 'wishlist');
  assert.equal(steamOnly({ section: 'pc', channel: 'keyshop', platform: 'steam', price: 3 }).hiddenBy, undefined);
  const w = wishlistDeals(['10', '20'], { 10: { name: 'A', price: 5, normal: 20, discount: 75, end: 1 }, 20: { name: 'B', price: 18, normal: 20, discount: 10 } });
  assert.deepEqual(w.map((d) => [d.title, d.platform, d.currency]), [['A', 'steam', 'EUR']]);
});

test('Bundles : magasins connus, jeux bien notés, prix', () => {
  const soon = Math.round(now / 1000) + 86400;
  const meta = (storename, title, url = 'https://www.humblebundle.com/games/x') => ({ storename, title, url, start: 1, end: soon });
  const games = { 1: { type: 1, id: 10 }, 2: { type: 2, id: 99, included: { 1: 11, 2: 12 } }, 3: { type: 1, id: 13 } };
  const list = parseBarter({ bundles: {
    1: { meta: meta('Humble Bundle', 'Resident Evil'), games },
    2: { meta: meta('DailyIndieGame', 'DIG Bundle'), games },
    3: { meta: meta('Indiegala', 'Lusty Lab Bundle'), games },
    4: { meta: { ...meta('Humble Bundle', 'Fini'), end: 5 }, games },
    5: { meta: meta('Fanatical', 'Build Your Own Capcom Collection', 'https://www.fanatical.com/en/pick-and-mix/capcom-collection?v=1'), games },
  } }, now);
  assert.deepEqual(list.map((b) => b.id), ['1', '5']);
  assert.deepEqual(list[0].appids, ['10', '11', '12', '13']);

  const it = (name, rating = 90, reviews = 5000) => ({ name, game: true, normal: 20, rating, reviews });
  const items = { 10: it('RE2'), 11: it('RE3'), 12: it('RE4'), 13: it('Obscur', 60, 50) };
  const fan = fanaticalTiers({ pickandmix: [{ type: 'bundle', slug: 'capcom-collection', tiers: [{ quantity: 3, price: { EUR: 1899 } }, { quantity: 2, price: { EUR: 1299 } }] }, { type: 'book-bundle', slug: 'livres', tiers: [{ quantity: 1, price: { EUR: 160 } }] }] });
  assert.deepEqual(fan, { 'capcom-collection': [{ n: 2, price: 12.99 }, { n: 3, price: 18.99 }] });
  assert.deepEqual(humbleTiers('aria-label="9 items for €35.80" … "3 items for €8.95" … "9 items for €35.80"'), [{ n: 3, price: 8.95 }, { n: 9, price: 35.8 }]);

  const out = buildBundles(list, items, { 1: [{ n: 3, price: 8.95 }, { n: 9, price: 35.8 }], 5: fan['capcom-collection'] }, { ...DEFAULT_SETTINGS });
  const humble = out.find((d) => d.id === 'bd:1');
  assert.equal(humble.price, 35.8);
  assert.equal(humble.normalPrice, 80);
  assert.equal(humble.bundle.good, 3);
  assert.deepEqual(humble.bundle.highlights, ['RE2', 'RE3', 'RE4']);
  assert.match(humble.priceNote, /dès 8,95/);
  const pick = out.find((d) => d.id === 'bd:5');
  assert.equal(pick.price, 12.99);
  assert.equal(pick.priceNote, '2 jeux au choix');
  assert.equal(pick.discount, null, 'pas de fausse remise sur un bundle à composer');
  assert.equal(buildBundles(list, items, {}, { ...DEFAULT_SETTINGS, level: 'strict' }).length, 0);
});

test('Clés Switch : noms réels, régions, comparaison à l’eShop', () => {
  assert.deepEqual(parseKeyName('Persona 5 Royal (Nintendo Switch) Nintendo eShop Key EUROPE'), { name: 'Persona 5 Royal', platform: 'switch1' });
  assert.deepEqual(parseKeyName('Mario Kart World (Nintendo Switch 2) Clé eShop EUROPE'), { name: 'Mario Kart World', platform: 'switch2' });
  assert.deepEqual(parseKeyName('Borderlands 3 Ultimate Edition EU Nintendo Switch CD Key'), { name: 'Borderlands 3 Ultimate Edition', platform: 'switch1' });
  assert.deepEqual(parseKeyName('Just Dance: Decades of Hits - Switch 2'), { name: 'Just Dance: Decades of Hits', platform: 'switch2' });
  for (const bad of ['Mario Kart 8 Deluxe Nintendo Switch Access', 'Nintendo eShop Prepaid Card €100 EU Key', 'Nintendo Switch Online - 12 Months (365 Days) Individual Membership EU', 'Animal Crossing: New Horizons - Happy Home Paradise DLC EU Nintendo Switch CD Key', 'Wo Long EU Nintendo Switch 2 Gift Card', 'Fortnite - Wildcat Bundle + 2000 V-Bucks (Nintendo Switch) eShop Key EUROPE', 'Hades (Nintendo Switch) eShop Key UNITED STATES', 'Légendes Pokémon : Z-A – Méga Dimension - Switch']) assert.equal(parseKeyName(bad), null, bad);

  const apollo = { a: { __typename: 'Product', name: 'Persona 5 Royal (Nintendo Switch) eShop Key EUROPE', slug: 'p5r', type: { value: 'GAME' }, 'cheapestAuction': { __ref: 'b' } }, b: { __typename: 'Auction', isInStock: true, 'price({"currency":"EUR"})': { amount: 1069 }, 'msrp({"currency":"EUR"})': { amount: 5999 } } };
  const [en] = parseEneba(`<script id="__APOLLO_STATE__" type="application/json">${JSON.stringify(apollo)}</script>`);
  assert.equal(en.price, 10.69);
  assert.equal(en.msrp, 59.99);
  const kg = parseKinguin({ _embedded: { products: [{ name: 'NieR: Automata The End of YoRHa Edition EU Nintendo Switch CD Key', price: { lowestOffer: 1360 }, externalId: '1', attributes: { urlKey: 'nier' } }, { name: 'Rupture EU Nintendo Switch CD Key', price: { lowestOffer: 1000000 } }] } });
  assert.equal(kg.length, 1);
  assert.equal(kg[0].price, 13.6);
  const [ig] = parseInstantGaming('{"item_name":"X","item_id":23715,"price":"22.99","price_eur":"22.99"} <a class="c" href="https://www.instant-gaming.com/fr/23715-acheter-just-dance/" title="acheter Just Dance: Decades of Hits - Switch 2">');
  assert.equal(ig.price, 22.99);
  assert.equal(ig.platform, 'switch2');

  const st = { ...DEFAULT_SETTINGS, switch: true, switch2: true, switchMinDiscount: 40 };
  const ref = (regular, nowPrice = regular, nintendo = false) => ({ at: now, ref: { regular, now: nowPrice, nintendo } });
  const deals = buildKeyDeals([...[en], ...kg, ig, { ...en, merchant: 'Kinguin', price: 9.5, ref: 'k' }], { 'switch1:persona 5 royal': ref(59.99), 'switch1:nier automata the end of yorha edition': ref(39.99, 13.99), 'switch2:just dance decades of hits': ref(49.99) }, st);
  const p5 = deals.filter((d) => d.title === 'Persona 5 Royal');
  assert.equal(p5.length, 1, 'la moins chère seulement');
  assert.equal(p5[0].merchant, 'Kinguin');
  assert.equal(p5[0].channel, 'keyshop');
  assert.ok(!deals.some((d) => /NieR/.test(d.title)), 'eShop en promo au même prix : pas une affaire');
  assert.ok(deals.some((d) => d.platform === 'switch2'));
  assert.ok(!buildKeyDeals([ig], { 'switch2:just dance decades of hits': ref(49.99) }, { ...st, switch2: false }).length);
});

test('Pages Dealabs : température, prix de référence, expirées, locales', () => {
  const thread = (o) => ({ type: 'Deal', threadId: '3438844', titleSlug: 'bravely-default', title: 'Bravely Default Flying Fairy HD Remaster sur Nintendo Switch 2', temperature: 486.2, price: 14.99, nextBestPrice: 29.99, publishedAt: Math.round(now / 1000) - 20 * 86400, merchant: { merchantName: 'Amazon' }, mainGroup: { threadGroupName: 'Consoles & Jeux vidéo' }, mainImage: { path: 'threads/raw/SQ6M7', name: '3438844_1' }, isLocal: false, selectedLocations: { isNational: false }, endDate: null, isExpired: false, ...o });
  const page = (...threads) => threads.map((t) => `<div data-vue3='${JSON.stringify({ name: 'ThreadMainListItemNormalizer', props: { thread: t } }).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')}'></div>`).join('');
  const st = { ...DEFAULT_SETTINGS, switch: true, switch2: true, departments: '80' };
  const read = (o) => classifyDealabs(mergeDealabsItems(parseDealabsPage(page(thread(o)), 'switch'))[0], st, now);
  const d = read({});
  assert.equal(d.price, 14.99);
  assert.equal(d.normalPrice, 29.99);
  assert.equal(d.discount, 50);
  assert.equal(d.temperature, 486);
  assert.equal(d.merchant, 'Amazon');
  assert.equal(d.platform, 'switch2');
  assert.ok(d.flags.hot && isExceptional(d));
  assert.match(d.images[0], /3438844_1\/re\/300x300/);
  assert.equal(read({ isExpired: true }), null);
  assert.equal(read({ temperature: -35 }), null);
  assert.equal(read({ endDate: { timestamp: 5 } }), null);
  assert.equal(read({ title: '[MegaThread] Récap des meilleures offres Nintendo Switch' }), null);
  assert.equal(read({ isLocal: true }), null, 'locale sans département');
  assert.ok(read({ isLocal: true, selectedLocations: { isNational: true } }), 'magasins de toute la France');
  assert.ok(read({ isLocal: true, title: 'Bravely Default sur Nintendo Switch 2 - Amiens (80)' }));
  // RSS + page : une seule annonce, avec les infos de la page
  const rssItem = { guid: 'https://www.dealabs.com/bons-plans/autre-slug-3438844', link: 'https://www.dealabs.com/bons-plans/autre-slug-3438844', title: 'Bravely Default', feed: 'switch', pubDate: now, category: 'Consoles & Jeux vidéo' };
  const merged = mergeDealabsItems([rssItem, ...parseDealabsPage(page(thread({ isExpired: true })), 'switch')]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].expired, true);
});

// ===========================================================================
// v1.3 : doublons, bundles, jeux gratuits, niveaux, recommandations
// ===========================================================================
import { gameKey, titlesMatch as sameTitle, sameGameStrict as sameStrict } from '../extension/src/titles.js';
import { groupDeals, dealKey } from '../extension/src/deals.js';
import { parseLootScraper, primeStoreFromUrl, parseGogGifts } from '../extension/src/sources/lootscraper.js';
import { gmgTiers, indieGalaTiers } from '../extension/src/sources/bundles.js';
import { parsePurchaseOptions, buildSteamBundles, parseGogPacks, parseItch } from '../extension/src/sources/storebundles.js';
import { keepAtLevel, WIDEST } from '../extension/src/levels.js';
import { tasteFrom, genresToHide, rankFranchises, filterHits, recommendedLevel } from '../extension/src/recommend.js';
import { assembleDeals } from '../extension/src/refresh-deals.js';
import { bundleStoreOf, PC_STORE_ORDER } from '../extension/src/config.js';

test('Doublons : même jeu écrit autrement', () => {
  const same = [
    ['Contractor: The Clean Up Part 2', 'Contractor: The Clean Up Part II'], ['The Last of Us Part Two', 'The Last of Us Part 2'], ['Grand Theft Auto V', 'Grand Theft Auto 5'],
    ['FINAL FANTASY VII REBIRTH', 'Final Fantasy 7 Rebirth'], ['Mortal Kombat11', 'Mortal Kombat 11'], ['Assassins Creed Odyssey', 'Assassin’s Creed® Odyssey'], ['Ratchet & Clank', 'Ratchet and Clank'],
    ['Hades II', 'Hades 2'], ['Super Mega Baseball™ 4', 'Super Mega Baseball 4'], ['The Witcher 3: Wild Hunt', 'Witcher 3 Wild Hunt'], ['Cleanup Crew', 'Clean Up Crew'], ['DOOM Eternal Deluxe Edition', 'DOOM Eternal'],
    ['Dragon Quest I & II', 'Dragon Quest I and 2'],
  ];
  for (const [a, b] of same) {
    assert.ok(sameStrict(a, b), `${a} = ${b}`);
    assert.ok(sameTitle(a, b), `${a} ~ ${b}`);
    assert.equal(gameKey(a), gameKey(b));
  }
  const different = [
    ['Contractor: The Clean Up', 'Contractor: The Clean Up Part 2'], ['Hades', 'Hades II'], ['Mega Man X', 'Mega Man 10'], ['DOOM', 'DOOM Eternal'], ['Hollow Knight', 'Hollow Knight: Silksong'],
    ['Borderlands 2', 'Borderlands 3'], ['Dragon Quest VII Reimagined', 'Dragon Quest XI S'], ['Resident Evil 2', 'Resident Evil Village'], ['FIFA 23', 'FIFA 24'], ['Dark Souls II', 'Dark Souls III'], ['Autumn’s end (Part 1)', 'Autumn’s end (Part 2)'],
  ];
  for (const [a, b] of different) {
    assert.ok(!sameStrict(a, b), `${a} ≠ ${b}`);
    assert.ok(!sameTitle(a, b), `${a} !~ ${b}`);
  }
});

test('Doublons : jeux gratuits vus par plusieurs sources', () => {
  const item = (source, title, o = {}) => ({ source, store: 'epic', title, url: source, images: [], status: 'active', ...o });
  const games = mergeGames([[item('epic', 'Mark of the Deep')], [item('gamerpower', 'Contractor: The Clean Up Part 2'), item('gamerpower', 'Mark of the Deep')], [item('dealabs', 'Contractor: The Clean Up Part II')]]);
  assert.deepEqual(games.map((g) => [g.title, g.sources.length]).sort(), [['Contractor: The Clean Up Part 2', 2], ['Mark of the Deep', 2]]);
  // Un même jeu Prime annoncé sur deux plateformes
  const prime = mergeGames([[item('lootscraper', 'WarBreeds', { store: 'gog', prime: true })], [item('gamerpower', 'WarBreeds', { store: 'amazon', prime: true })]]);
  assert.equal(prime.length, 1);
  assert.equal(prime[0].store, 'gog');
  // Offert séparément sur Epic et GOG : deux vraies offres
  assert.equal(mergeGames([[item('epic', 'Hades')], [item('gog', 'Hades', { store: 'gog' })]]).length, 2);
});

test('Doublons : une carte par jeu dans les promos', () => {
  const dl = (id, title, price, merchant, o = {}) => ({ id, source: 'dealabs', section: 'switch', channel: 'physical', platform: 'switch2', title, price, merchant, currency: 'EUR', url: id, images: [], flags: {}, ...o });
  const out = groupDeals([
    dl('dl:1', 'The Legend of Zelda : Ocarina of Time sur Nintendo Switch 2 (Via Retrait Magasin)', 51.49, 'E.Leclerc', { temperature: 4841, flags: { hot: true } }),
    dl('dl:2', 'Legend of Zelda: Ocarina of Time sur Nintendo Switch 2 - Ormesson (94)', 42.9, 'Courses U', { temperature: 300 }),
    dl('dl:3', 'Dragon Quest VII Reimagined sur Nintendo Switch', 32.46, 'Amazon', { platform: 'switch1' }),
    dl('dl:4', 'Dragon Quest VII: Reimagined sur Nintendo Switch 2', 33.68, 'E.Leclerc'),
    dl('dl:5', 'Sélection de jeux Nintendo Switch en promotion', 9.95, 'Action'),
    dl('dl:6', 'Sélection de jeux Nintendo Switch en promotion', 8, 'Fnac'),
  ]);
  const zelda = out.find((d) => /Zelda/.test(d.title));
  assert.equal(zelda.price, 42.9);
  assert.equal(zelda.temperature, 4841);
  assert.ok(zelda.flags.hot);
  assert.deepEqual(zelda.ids, ['dl:2', 'dl:1']);
  assert.deepEqual(zelda.others.map((o) => [o.merchant, o.price]), [['E.Leclerc', 51.49]]);
  assert.equal(out.length, 5, 'Switch et Switch 2 séparées, sélections laissées à part');
  // Bundles : Humble Choice écrit de deux façons
  const bd = (id, title, price) => ({ id, source: 'bundle', section: 'bundle', channel: 'bundle', store: 'humble', merchant: 'Humble Bundle', title, price, flags: {}, images: [] });
  const choice = groupDeals([bd('bd:1', 'November 2026 Humble Choice (#84)', null), { ...bd('dl:9', 'Humble Bundle Choice - Novembre 2026', 12.99), source: 'dealabs' }]);
  assert.equal(choice.length, 1);
  assert.equal(choice[0].price, 12.99);
  // Promo PC vue sur CheapShark et sur Dealabs : une carte, l'offre Dealabs ajoutée
  const cs = { id: 'cs:1', source: 'cheapshark', section: 'pc', channel: 'official', platform: 'steam', title: 'Metro Exodus', price: 3, currency: 'EUR', flags: {}, offers: { steam: { price: 3, merchant: 'Steam' } } };
  const deals = buildDeals({ cheapshark: [cs], dealabs: [{ id: 'dl:7', source: 'dealabs', section: 'pc', channel: 'official', platform: 'steam', title: 'Metro Exodus sur PC (Dématérialisé)', price: 2.99, currency: 'EUR', merchant: 'Steam', flags: { hot: true } }] }, {}, {}, now);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].price, 2.99);
  assert.ok(deals[0].flags.hot);
  assert.equal(dealKey({ source: 'dealabs', section: 'pc', title: 'Sélection de jeux EA sur PC' }), null);
});

test('LootScraper : Prime, GOG, Ubisoft ; cadeaux GOG', () => {
  const entry = (source, title, url, platform = 'PC', to = '2099-01-08 00:00') => `<entry><title>${source === 'AMAZON' ? 'Amazon Prime' : source} (Game, ${platform}) - ${title}</title><content type="xhtml"><div><img src="https://img/x.jpg" /><ul><li><b>Offer valid from:</b> 2026-10-08 18:00</li><li><b>Offer valid to:</b> ${to}</li><li><b>Recommended price (Steam):</b> 5.99 EUR</li></ul></div></content><link href="${url}"/><category term="source:${source}"/><category term="platform:${platform}"/><category term="type:GAME"/></entry>`;
  const items = parseLootScraper([
    entry('AMAZON', 'WarBreeds', 'https://luna.amazon.com/claims/warbreeds-gog/dp/x?a=1&amp;b=2'), entry('AMAZON', 'Kiborg', 'https://luna.amazon.com/claims/kiborg-aga/dp/x'),
    entry('UBISOFT', 'Watch Dogs', 'https://store.ubisoft.com/x'), entry('EPIC', 'Lonesome Village', 'https://x', 'ANDROID'), entry('GOG', 'Fini', 'https://gog.com/x', 'PC', '2020-01-01 00:00'),
  ].join(''), now);
  assert.deepEqual(items.map((i) => [i.title, i.store, i.prime]), [['WarBreeds', 'gog', true], ['Kiborg', 'amazon', true], ['Watch Dogs', 'ubisoft', false]]);
  assert.equal(items[0].worth, '5,99 €');
  assert.match(items[0].url, /a=1&b=2/);
  assert.equal(primeStoreFromUrl('https://luna.amazon.com/claims/time-travel-escape-room-game-legacy/dp/1'), 'legacy');
  assert.equal(primeStoreFromUrl('https://luna.amazon.com/claims/ad-infinitum-epic/dp/1'), 'epic');
  const gift = (final, base) => ({ title: 'X', storeLink: 'u', price: { finalMoney: { amount: final }, baseMoney: { amount: base } } });
  assert.equal(parseGogGifts({ products: [gift('0.00', '19.99'), gift('0.00', '0.00'), gift('5.00', '9.99')] }).length, 1);
});

test('Bundles : quatre cases, vendeurs suivis et prix GMG', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS.bundleStores), ['humble', 'keys', 'stores', 'indie']);
  assert.deepEqual(['Humble Bundle', 'Fanatical', 'Green Man Gaming', 'Digiphile', 'Steam', 'GOG', 'Epic Games Store', 'itch.io', 'Indiegala'].map(bundleStoreOf), ['humble', 'keys', 'keys', 'keys', 'stores', 'stores', 'stores', 'indie', 'indie']);
  for (const m of ['Xsolla', 'Planetplay', 'Into Games', 'Tiltify', 'Steamground', '']) assert.equal(bundleStoreOf(m), null, m);
  assert.deepEqual(gmgTiers('Worth €175.93 <span class="price">€5.00</span> <span class="price">€16.00</span> <span class="price">€11.00</span>').map((t) => t.price), [5, 11, 16]);
});

test('Launcher : toujours déduit, jamais « non précisé »', () => {
  const pc = (title, merchant, description = '') => classifyDealabs({ guid: title, title, merchant, description, link: 'https://www.dealabs.com/bons-plans/x-1234567', pubDate: now, category: 'Consoles & Jeux vidéo', priceText: '9,99€', feed: 'pc', hot: true }, { ...DEFAULT_SETTINGS, stores: Object.fromEntries(PC_STORE_ORDER.map((s) => [s, true])) }, now)?.platform;
  assert.equal(pc('Lies of P sur PC (Dématérialisé)', 'Fanatical'), 'steam');
  assert.equal(pc('Lies of P sur PC (Dématérialisé)', 'Gamivo'), 'steam');
  assert.equal(pc('Red Dead Redemption sur PC (Dématérialisé)', '', 'Clé à activer sur Epic Games Store'), 'epic');
  assert.equal(pc('Like a Dragon sur Xbox Series X|S & PC (Dématérialisé)', 'Xbox Store'), 'microsoft');
});

test('Niveaux : lecture au plus large, tri ensuite', () => {
  const at = (level) => ({ ...DEFAULT_SETTINGS, ...LEVELS[level], level });
  const cs = { source: 'cheapshark', crit: { normal: 59.99, meta: 90, steam: 92, count: 9000 }, flags: {}, offers: { steam: { price: 20, discount: 65 }, epic: { price: 25, discount: 45 } }, platform: 'steam', price: 20, discount: 65 };
  const n = (d, level) => keepAtLevel([structuredClone(d)], at(level)).length;
  assert.deepEqual(['strict', 'balanced', 'wide'].map((l) => n(cs, l)), [0, 1, 1]);
  assert.deepEqual(Object.keys(keepAtLevel([structuredClone(cs)], at('balanced'))[0].offers), ['steam']);
  assert.deepEqual(Object.keys(keepAtLevel([structuredClone(cs)], at('wide'))[0].offers), ['steam', 'epic']);
  const es = { source: 'eshop', discount: 45, flags: { popular: false } };
  assert.deepEqual(['strict', 'balanced', 'wide'].map((l) => n(es, l)), [0, 1, 1]);
  const bd = { source: 'bundle', bundle: { good: 4 }, flags: {} };
  assert.deepEqual(['strict', 'balanced', 'wide'].map((l) => n(bd, l)), [0, 1, 1]);
  assert.equal(n({ source: 'gog', discount: 10, flags: { wishlist: true } }, 'strict'), 1, 'souhait toujours gardé');
  for (const l of Object.values(LEVELS)) for (const k of ['pcMinDiscount', 'gemMinDiscount', 'gemMinRating', 'switchMinDiscount']) assert.ok(WIDEST[k] <= l[k], k);
  // Sans réseau, depuis le cache, et sans abîmer le cache
  const cache = { cheapshark: { items: [{ ...cs, id: 'cs:1', section: 'pc', channel: 'official', title: 'A' }], at: now } };
  const copy = structuredClone(cache);
  assert.equal(assembleDeals(at('strict'), cache, {}, now).deals.length, 0);
  assert.equal(assembleDeals(at('wide'), cache, {}, now).deals.length, 1);
  assert.deepEqual(cache, copy);
});

test('Recommandations : goûts Steam, effet des filtres, niveau conseillé', () => {
  const games = [...Array.from({ length: 30 }, (_, i) => ({ name: 'RPG ' + i, tags: [122] })), { name: 'LEGO City', tags: [21] }, { name: 'Borderlands 2', tags: [1663] }, { name: 'Borderlands 3', tags: [1774] }];
  const taste = tasteFrom(games);
  assert.equal(taste.total, 33);
  assert.equal(taste.genres.rpg, 30);
  assert.equal(taste.franchises.Borderlands, 2);
  const hide = genresToHide(taste, { sport: 12, racing: 3 }, ['horror']);
  assert.equal(hide[0], 'sport', 'le plus utile d’abord');
  assert.ok(!hide.includes('rpg') && !hide.includes('horror') && !hide.includes('shooter'));
  assert.deepEqual(genresToHide(tasteFrom(games.slice(0, 5)), {}), [], 'trop peu de jeux pour conclure');
  const ranked = rankFranchises(taste, { 'Mass Effect': 4, LEGO: 9 });
  assert.equal(ranked[0].keyword, 'Mass Effect');
  assert.ok(ranked[0].star);
  assert.ok(ranked.find((r) => r.keyword === 'LEGO').owned === 1 && !ranked.find((r) => r.keyword === 'LEGO').star);
  assert.equal(rankFranchises(null, { LEGO: 9 })[0].keyword, 'LEGO', 'sans Steam : seulement l’effet sur les annonces');
  const hits = filterHits([{ title: 'LEGO Batman' }, { title: 'EA FC 27' }], [{ title: 'Zombie Army 4' }]);
  assert.equal(hits.keywords.LEGO, 1);
  assert.equal(hits.keywords['EA Sports FC'], 1);
  assert.equal(hits.keywords['Zombie Army'], 1);
  assert.equal(recommendedLevel({ strict: 100, balanced: 200, wide: 240 }), 'balanced');
  assert.equal(recommendedLevel({ strict: 200, balanced: 430, wide: 450 }), 'strict');
});

test('Réglages par défaut et listes demandées', () => {
  assert.equal(DEFAULT_SETTINGS.intervalHours, 0.25);
  assert.deepEqual(PC_STORE_ORDER, ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'battlenet', 'microsoft', 'itch', 'indiegala', 'other']);
  for (const k of ['BioShock', 'Borderlands', 'Dead Island', 'Killing Floor', 'Mass Effect', 'Zombie Army']) assert.ok(KEYWORD_SUGGESTIONS.includes(k), k);
});

test('Bundles Steam, GOG et itch.io', () => {
  const options = parsePurchaseOptions({ response: { store_items: [{ purchase_options: [
    { bundleid: 1, purchase_option_name: 'Metro Saga Bundle', final_price_in_cents: '900', included_game_count: 3, active_discounts: [{ discount_end_date: 1796317200 }] },
    { packageid: 9, final_price_in_cents: '299', included_game_count: 1 }, { bundleid: 2, purchase_option_name: 'Cher', final_price_in_cents: '5000', included_game_count: 3 },
    { bundleid: 3, purchase_option_name: 'Mal noté', final_price_in_cents: '100', included_game_count: 2 },
  ] }] } });
  assert.deepEqual(Object.keys(options), ['1', '2', '3']);
  const it = (name, rating = 90, game = true) => ({ name, game, normal: 20, rating, reviews: 5000 });
  const items = { 10: it('Metro 2033'), 11: it('Metro Exodus'), 12: it('Metro DLC', 90, false), 13: it('Bof', 40), 14: it('Bof 2', 45) };
  const steam = buildSteamBundles(options, { 1: [10, 11, 12], 2: [10, 11], 3: [13, 14] }, items);
  assert.deepEqual(steam.map((d) => d.title), ['Metro Saga Bundle']);
  assert.equal(steam[0].normalPrice, 40, 'les DLC ne comptent pas');
  assert.equal(steam[0].discount, 78);
  assert.equal(steam[0].store, 'stores');

  const p = (title, final, base, rating = 0, count = 0) => ({ id: title, title, storeLink: 'u', price: { finalMoney: { amount: String(final), currency: 'EUR' }, baseMoney: { amount: String(base) } }, reviewsRating: rating, reviewsCount: count });
  const gog = parseGogPacks([p('Mafia Trilogy', 11.99, 59.99, 42, 43), p('Fallout Franchise Bundle', 21.95, 109.75), p('Sans note et peu remisé Bundle', 35, 100), p('Fallout 3 GOTY', 4.99, 19.99, 46, 2000), p('Mal noté Collection', 2, 20, 30, 900)]);
  assert.deepEqual(gog.map((d) => d.title), ['Mafia Trilogy', 'Fallout Franchise Bundle']);
  assert.equal(gog[0].platform, 'gog');

  const row = (id, title, label, icons = 'icon-windows8', end = '2099-01-01T00:00:00Z') => `<div data-sale_id="${id}" class="sale_row"><div class="sale_title"><a href="/b/${id}/x">${title}</a></div><div class="game_count">${label}</div><span class="date_format">${end}</span><span class="icon ${icons}"></span><img data-lazy_src="https://img/x.png"/></div>`;
  const soon = new Date(now + 20 * 24 * 3600e3).toISOString();
  const itch = parseItch([
    row(1, 'SpeedJam &amp; co', '7 items for <del>$20.00</del> <strong>$4.00</strong> (save 80%)', 'icon-windows8', soon), row(2, 'Assets', '4 asset packs for $9.99', 'icon-windows8', soon), row(3, 'Livres', '3 books for $18.99', '', soon),
    row(4, 'Trop cher', '6 games for $60.00', 'icon-windows8', soon), row(5, 'Trop petit', '2 games for $1.00', 'icon-windows8', soon), row(6, 'Permanent', '9 games for $5.00'), row(7, 'En euros', '10 games for 8.00€', 'icon-windows8', soon),
  ].join(''), 0.9, now);
  assert.deepEqual(itch.map((d) => d.title), ['En euros', 'SpeedJam & co']);
  assert.equal(itch[0].approx, false);
  assert.equal(itch[1].price, 3.6);
  assert.equal(itch[1].normalPrice, 18);
  assert.match(itch[1].priceNote, /7 jeux, sans DRM/);
  assert.equal(itch[1].store, 'indie');
});

test('Cases de bundles : stores cochés, cases décochées, vendeurs écartés', () => {
  const b = (id, store, platform, merchant) => ({ id, source: 'storebundle', section: 'bundle', channel: 'bundle', store, platform, merchant, title: id, price: 5, discount: 90, currency: 'EUR', flags: {} });
  const cache = {
    storebundles: { at: now, items: [b('Metro Saga', 'stores', 'steam', 'Steam'), b('Mafia Trilogy', 'stores', 'gog', 'GOG')] },
    itchbundles: { at: now, items: [{ ...b('Jam', 'indie', 'itch', 'itch.io'), source: 'itch' }] },
    bundles: { at: now, items: [{ ...b('Resident Evil', 'humble', 'steam', 'Humble Bundle'), source: 'bundle', bundle: { good: 8, games: 9, highlights: [], appids: [] } }, { ...b('Vieux cache', 'other', 'steam', 'Xsolla'), source: 'bundle', store: null, bundle: { good: 9 } }] },
  };
  const titles = (o) => assembleDeals({ ...DEFAULT_SETTINGS, ...LEVELS.balanced, dealabs: false, ...o }, cache, {}, now).deals.map((d) => d.title).sort();
  assert.deepEqual(titles({}), ['Jam', 'Mafia Trilogy', 'Metro Saga', 'Resident Evil']);
  assert.deepEqual(titles({ stores: { ...DEFAULT_SETTINGS.stores, gog: false } }), ['Jam', 'Metro Saga', 'Resident Evil'], 'GOG décoché : pas ses bundles');
  assert.deepEqual(titles({ bundleStores: { humble: true, keys: true, stores: false, indie: false } }), ['Resident Evil']);
  assert.deepEqual(titles({ bundles: false }), []);
  const dl = (merchant) => classifyDealabs({ guid: 'g', title: 'Super Bundle sur PC (Dématérialisé)', merchant, description: '', link: 'https://www.dealabs.com/bons-plans/x-1234567', pubDate: now, category: 'Consoles & Jeux vidéo', priceText: '5€', feed: 'pc', hot: true }, { ...DEFAULT_SETTINGS }, now);
  assert.equal(dl('Humble Bundle').store, 'humble');
  assert.equal(dl('Xsolla'), null);
});

test('Indie sans DRM : bundles IndieGala (notes réelles), adultes et packs de DLC écartés', () => {
  const g = (name, rating, reviews, game = true) => ({ name, rating, reviews, game, normal: 4.9 });
  const items = {
    1: g('Defense high', 83, 112), 2: g('Lab Inspect', 86, 37), 3: g('Power Driver', 96, 25), 4: g('Halt', 70, 60), 5: g('Wanderer', 75, 56),
    11: g('Pixel Puzzles Pack 4', 50, 2, false), 12: g('Pixel Puzzles Pack 5', 50, 2, false), 13: g('Pixel Puzzles Pack 6', 100, 1, false), 14: g('Pixel Puzzles XL', 33, 3, false),
    21: g('Lust Epidemic 18+', 90, 175), 22: g('A', 90, 20), 23: g('B', 90, 20), 24: g('C', 90, 20),
    31: g('Nul 1', 40, 50), 32: g('Nul 2', 45, 50), 33: g('Nul 3', 50, 50), 34: g('Nul 4', 60, 50),
  };
  const b = (id, title, appids) => ({ id, merchant: 'IndieGala', title, url: 'https://www.indiegala.com/bundle/x', start: 1, end: now + 1e9, appids });
  const tiers = indieGalaTiers('Pay <strong class="plt-color-main">$3.49</strong> or more');
  const out = buildBundles([b('1', 'Power Halt Bundle', ['1', '2', '3', '4', '5']), b('2', 'Pixel Traditions', ['11', '12', '13', '14']), b('3', 'Bundle discret', ['21', '22', '23', '24']), b('4', 'Nul', ['31', '32', '33', '34'])], items, { 1: tiers }, { ...DEFAULT_SETTINGS, ...WIDEST }, 0.9);
  assert.deepEqual(out.map((d) => d.title), ['Power Halt Bundle']);
  assert.equal(out[0].store, 'indie');
  assert.equal(out[0].price, 3.14);
  assert.equal(out[0].approx, true);
  assert.equal(out[0].bundle.average, 82);
  assert.match(out[0].priceNote, /clés Steam/);
  const at = (level) => keepAtLevel(structuredClone(out), { ...DEFAULT_SETTINGS, ...LEVELS[level], level }).length;
  assert.deepEqual(['strict', 'balanced', 'wide'].map(at), [0, 1, 1]);
  assert.equal(parseBarter({ bundles: { 9: { meta: { storename: 'Indiegala', title: 'Lusty Lab Bundle', url: 'u', start: 1, end: Math.round(now / 1000) + 9999 }, games: { 1: { type: 1, id: 1 } } } } }, now).length, 0);
});

// ---------- Tutoriel : une catégorie à la fois ----------

const { STEPS } = await import('../extension/onboarding/steps.js');
const flow = await import('../extension/onboarding/flow.js');
const tutoDraft = (o = {}) => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });
const walk = (d) => {
  const seen = [];
  let pos = flow.start(STEPS, d);
  for (let i = 0; i < 100; i++) {
    seen.push(pos.part ? `${pos.step}/${pos.part}` : pos.step);
    const res = flow.forward(STEPS, d, pos);
    if (res.done) return seen;
    assert.equal(res.error, undefined, `bloqué sur ${seen.at(-1)}`);
    pos = res.pos;
  }
  throw new Error('tutoriel sans fin');
};

test('Tutoriel : plateformes, puis bundles, puis Amazon Prime, une catégorie à la fois', () => {
  const d = tutoDraft();
  const only = (id) => walk(d).filter((x) => x.startsWith(id));
  assert.deepEqual(only('stores'), ['stores/stores', 'stores/bundles', 'stores/bundleSites', 'stores/prime']);
  d.bundles = false;
  d.prime = true;
  assert.deepEqual(only('stores'), ['stores/stores', 'stores/bundles', 'stores/prime', 'stores/primeStores']);
  assert.deepEqual(only('platforms'), ['platforms/machines']);
  d.switch = true;
  assert.deepEqual(only('platforms'), ['platforms/machines', 'platforms/switch2']);
  assert.ok(walk(tutoDraft({ pc: false, switch: true })).every((x) => !/^(stores|steam)/.test(x) && x !== 'content/pc' && x !== 'alerts/autoClick'));
});

test('Tutoriel : aller-retour complet, quelles que soient les réponses', () => {
  for (let n = 0; n < 128; n++) {
    const bit = (i) => !!(n & (1 << i));
    const d = tutoDraft({ pc: bit(0) || !bit(1), switch: bit(1), switch2: bit(2), bundles: bit(3), prime: bit(4), physical: bit(5), freeGames: bit(6) || !bit(1) });
    if (bit(2)) d.stores.steam = false;
    const go = walk(d);
    assert.equal(new Set(go).size, go.length);
    // Aller : la barre avance à chaque catégorie. Retour : page par page, tout déjà vu.
    let pos = flow.start(STEPS, d);
    let last = 0;
    for (;;) {
      const { ratio, page, pages } = flow.progress(STEPS, d, pos);
      assert.ok(ratio > last && ratio <= 1 && page <= pages);
      last = ratio;
      const res = flow.forward(STEPS, d, pos);
      if (res.done) break;
      pos = res.pos;
    }
    assert.equal(last, 1);
    const back = [];
    for (; pos; pos = flow.backward(STEPS, d, pos)) {
      back.unshift(pos.step);
      assert.ok(flow.progress(STEPS, d, pos).complete && !flow.follow(STEPS, d, pos));
    }
    assert.deepEqual(back, [...new Set(go.map((x) => x.split('/')[0]))]);
  }
});

test('Tutoriel : réponses impossibles refusées, avec retour à la bonne question', () => {
  const at = ({ step, part }, expected) => assert.deepEqual({ step, part }, expected);
  const seen = STEPS.flatMap((s) => (s.parts || []).map((p) => `${s.id}/${p.id}`));
  const none = tutoDraft({ pc: false, switch: false });
  const r1 = flow.forward(STEPS, none, { step: 'platforms', part: 'machines' });
  assert.match(r1.error, /plateforme/);
  at(r1.pos, { step: 'platforms', part: 'machines' });

  const noStore = tutoDraft({ bundles: false });
  for (const k of Object.keys(noStore.stores)) noStore.stores[k] = false;
  const r2 = flow.forward(STEPS, noStore, { step: 'stores', part: 'prime', seen });
  assert.match(r2.error, /plateforme/);
  at(r2.pos, { step: 'stores', part: 'stores' });

  const nothing = tutoDraft({ switch: true, freeGames: false, pcDeals: false, bundles: false, switchDeals: false });
  const r3 = flow.forward(STEPS, nothing, { step: 'content', part: 'keyshops', seen });
  assert.match(r3.error, /catégorie/);
  at(r3.pos, { step: 'content', part: 'pc' });

  // « Passer » saute toute la page
  at(flow.forward(STEPS, tutoDraft(), { step: 'steam', part: 'steam' }, { skipPage: true }).pos, { step: 'exclude', part: 'genres' });
});

test('Tutoriel : la flèche descend de catégorie en catégorie, puis montre le bouton', () => {
  const d = tutoDraft();
  const path = (pos) => {
    const out = [pos.part];
    for (let to = pos; (to = flow.follow(STEPS, d, to));) out.push(to.part);
    return out;
  };
  const page = flow.select(STEPS, d, { step: 'stores' }, 'stores');
  assert.deepEqual(path(page), ['stores', 'bundles', 'bundleSites', 'prime']);

  // Catégorie sautée d'un clic : la flèche y revient. Réponse modifiée plus haut : elle ne remontre rien.
  assert.deepEqual(path(flow.select(STEPS, d, page, 'bundleSites')), ['bundleSites', 'prime', 'bundles']);
  let pos = page;
  for (let to; (to = flow.follow(STEPS, d, pos));) pos = to;
  assert.deepEqual(path(flow.select(STEPS, d, pos, 'stores')), ['stores']);

  // « Oui » à Prime ouvre une catégorie de plus : la flèche y va.
  d.prime = true;
  assert.deepEqual(path(pos), ['prime', 'primeStores']);
});
