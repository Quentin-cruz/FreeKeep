# FreeKeep<3 (v4) : jeux gratuits à vie & vrais bons plans, à ta mesure

<img src="extension/icons/logo-512.png" width="96" alt="Logo FreeKeep<3">

Extension Chrome / Opera GX / Edge / Brave (Manifest V3) organisée en trois sections.

| Section | Contenu |
|---|---|
| 🎁 **Gratuits** | Jeux PC offerts à garder à vie : Epic, Steam, GOG, Ubisoft, EA, Battle.net, Microsoft Store, **Amazon Prime** (Amazon Games, Legacy Games, Luna), **et les drops ponctuels** (Alienware Arena, Fanatical, Humble Bundle, IndieGala, itch.io…) |
| 💻 **Promos PC** | Seulement les **gros jeux bien notés** et les **pépites** très appréciées à grosse remise, sur les stores officiels et les sites de clés |
| 🎮 **Switch** | Grosses promos **eShop** (jeux jouables sur Switch 1), **jeux en boîte** (Amazon, Fnac, Leclerc…) et **clés** |

## Installation

1. Dézippe l'archive. Range le dossier quelque part de fixe, par exemple `Documents\FreeKeep` : le navigateur le relit à chaque démarrage.
2. Ouvre `chrome://extensions` (ou `opera://extensions`, `edge://extensions`).
3. Active le **Mode développeur**.
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`extension/`**.
5. Épingle l'icône ❤️ (le cœur).

**Mise à jour** : remplace le contenu du dossier `extension/`, puis clique sur ↻ (Recharger) sur la carte FreeKeep<3. Ton historique est conservé. En passant de la v3 à la v4, les réglages s'ouvrent pour que tu choisisses les nouvelles options (Amazon Prime, Battle.net, Microsoft Store, GOG).

## Personnalisation

**Tutoriel au premier lancement**, relançable depuis Réglages → « Relancer le tutoriel ». Il a 9 étapes avec l'accueil, certaines n'apparaissent que si elles te concernent :

1. **Plateformes** : PC, Switch, et « je veux aussi les jeux Switch 2 ».
2. **Stores PC** où tu actives tes jeux : Steam, Epic Games, Ubisoft Connect, GOG, EA app, Battle.net, Microsoft Store, itch.io, IndieGala, Autres. Puis **« J'ai Amazon Prime »** : Amazon Games, Legacy Games, Luna (cloud).
3. **Ce que tu veux voir** : jeux gratuits, promos PC, promos Switch, jeux en boîte (+ ton département), sites de clés, bundles.
4. **Niveau d'exigence** : 🔥 que les affaires de fou, ⚖️ équilibré ou 🌊 large.
5. **Tes bibliothèques** : lecture de tes jeux Steam et GOG via les sessions déjà ouvertes dans ton navigateur (lien de profil Steam facultatif). Les promos sur tes jeux sont masquées et ta liste de souhaits Steam est mise en avant.
6. **Ce que tu ne veux pas voir** : 16 genres à masquer (horreur, sport, contenu adulte…) et des licences à bannir par mot-clé (FIFA, Call of Duty…).
7. **Alertes** : notifications, fréquence, clic automatique.
8. **Récapitulatif**.

**Menus adaptatifs** : le popup n'affiche que tes sections. Il n'y a pas de barre de sections s'il n'y en a qu'une, pas de filtre Switch 2 si tu ne l'as pas choisi, et pas d'onglet « Bientôt » sans Epic. Les éléments masqués par tes filtres restent consultables (« 🚫 N masqués par tes filtres »), avec la raison du masquage.

**Réglages en 6 onglets** : Mes plateformes (+ Amazon Prime) · Ce que je veux voir · Filtres · Mes bibliothèques · Alertes · Sources & données.

### Bibliothèque Steam : via ta session, sans mot de passe

- Steam ne montre plus la liste des jeux d'un profil sans connexion, même s'il est public. FreeKeep<3 lit donc tes jeux et ta liste de souhaits via ta session `store.steampowered.com`, si tu es déjà connecté dans ce navigateur. Aucun identifiant n'est demandé ni enregistré. Désactivable dans les réglages.
- **Lien de profil (facultatif)** : sans session ouverte, il permet de lire ta liste de souhaits si elle est publique. Avec une session, FreeKeep<3 essaie aussi de lire les noms de tes jeux pour les reconnaître dans les annonces Dealabs.
- Ce que ça change :
  - les promos sur les jeux que tu possèdes sont masquées ;
  - les jeux gratuits Steam que tu as déjà sont cochés « récupérés » ;
  - les jeux de ta liste de souhaits remontent en tête dès -20 %, et une alerte part dès -50 %.
- La bibliothèque se resynchronise toutes les 12 h (toutes les heures si tu n'étais pas connecté), ou avec le bouton « Synchroniser ».

### Bibliothèque GOG : via ta session, sans mot de passe

- Si tu es déjà connecté à gog.com dans ton navigateur, FreeKeep<3 lit ta liste de jeux GOG (`gog.com/userData.json` puis `account/getFilteredProducts`). Aucun identifiant n'est demandé ni enregistré.
- Ce que ça change : les promos sur ces jeux sont masquées (correspondance stricte du nom), et les jeux gratuits GOG que tu as déjà sont cochés « récupérés ».
- Pas connecté ? La carte GOG des réglages l'indique ; connecte-toi sur gog.com puis clique « Synchroniser ». Désactivable à tout moment.

**Autres plateformes** : Epic, Ubisoft, EA, Battle.net, Microsoft Store et Amazon ne publient pas de bibliothèque lisible sans te connecter à ton compte. FreeKeep<3 note donc un jeu comme possédé quand sa page affiche « Dans la bibliothèque », ou quand tu cliques « Je l'ai ».

### Amazon Prime (ex-Prime Gaming)

- Coche « J'ai Amazon Prime » pour voir les jeux offerts aux abonnés. Sans Prime, ils restent cachés : tu ne pourrais pas les récupérer.
- Les jeux Prime à activer sur **Epic**, **GOG** ou le **Microsoft Store** suivent tes choix de stores. Les autres vont dans **Amazon Games** (l'application d'Amazon), **Legacy Games** (codes) ou **Luna** (jeux en cloud, à jouer en streaming : pas à garder, donc ni comptés dans le badge ni ouverts par « Tout récupérer »).
- Chaque jeu Prime porte le badge 👑 Prime.

### Switch / Switch 2

Chaque bon plan Switch est classé **Switch** (jouable sur Switch 1, et donc aussi sur Switch 2) ou **Switch 2** (exclusif). Le classement s'appuie sur les codes Nintendo (HAC = Switch 1, BEE = Switch 2) et sur les titres Dealabs. Les jeux Switch 2 n'apparaissent que si tu les as demandés.

### Genres

- Les genres viennent des données officielles Steam (genres et avertissements de contenu) et des catégories de l'eShop Nintendo.
- Pour l'horreur, le FPS, le puzzle, etc., les tags joueurs viennent de SteamSpy, interrogé seulement si tu masques un de ces genres.
- **Contenu adulte** : seuls les avertissements Steam « réservé aux adultes » et « nudité ou sexe fréquents » comptent. Un jeu avec un peu de nudité (The Witcher 3, Cyberpunk 2077…) reste visible.
- Pour les jeux sans données (Epic, Dealabs…), FreeKeep se base sur le titre.
- La liste de souhaits ignore le filtre de genres, mais pas les mots-clés bannis.

## Vérifications automatiques

- Les vérifications interrogent les vrais sites. Elles tournent en arrière-plan, même popup fermé, tant que le navigateur est ouvert.
- **Fréquence** : toutes les heures par défaut, réglable de 30 min à 24 h. Aucune notification n'est envoyée tant que le tutoriel n'est pas terminé. Une vérification se lance aussi :
  - à l'installation ;
  - au démarrage du navigateur ;
  - à l'ouverture du popup si la dernière date de plus de 30 min.
- **Réglages → État des sources** : chaque source y est affichée en direct (✔ nombre de résultats ou ✘ erreur), avec l'heure de la prochaine vérification et un bouton « Vérifier maintenant ».
- Pour ne pas se faire bloquer par les API, chaque source garde ses résultats un minimum de temps : 15 min pour CheapShark et l'eShop, 10 min pour Dealabs, 50 min pour GG.deals.

## 🎁 Gratuits

- Sources : API officielle Epic, recherche Steam (-100 %), [GamerPower](https://www.gamerpower.com), qui recense les giveaways de jeux PC (dont Prime), et les jeux offerts postés sur [Dealabs](https://www.dealabs.com) (Prime, Microsoft Store, Battle.net…). Les week-ends gratuits, démos, free-to-play et DLC sont écartés.
- Le site qui organise le giveaway est affiché, par exemple « via Alienware Arena ». Ces sites demandent parfois un compte.
- Le bouton **Récupérer** ouvre la page du store et clique sur « Obtenir » pour toi. Sur Epic, la commande n'est validée que si le total est à 0 €. Les captchas restent à faire toi-même.
- Les jeux que tu possèdes déjà sont détectés : sur Steam et GOG via ta session, sur les stores quand la page affiche « Dans la bibliothèque ».

## 💻 Promos PC : que des pépites

| Source | Ce qu'elle apporte |
|---|---|
| [CheapShark](https://www.cheapshark.com) | Promos sur 30+ stores officiels (Steam, GOG, Humble, Fanatical, GMG, Gamesplanet, Battle.net…), avec la note Metacritic et les avis Steam |
| [Dealabs](https://www.dealabs.com) | Deals **hot** validés par la communauté, y compris sur les sites de clés (Eneba, Instant Gaming, G2A…), et **erreurs de prix** |
| [GG.deals](https://gg.deals) *(facultatif)* | Prix des **sites de clés** en euros, plus bas historiques, surveillance des gros jeux |

Ce qui est gardé (seuils réglables) :
- **Gros jeu** : vendu 29 $ ou plus, Metacritic 75+ ou avis Steam 80 %+, remise d'au moins 60 %.
- **💎 Pépite** : avis Steam 90 %+ (3 000 avis minimum), remise d'au moins 70 %.

Badges : ⚠️ erreur de prix · 📉 chute soudaine (-30 % depuis la vérif précédente) · 🏆 plus bas historique · 🔥 hot Dealabs · 🔑 prix sur les sites de clés.

**Activer les sites de clés** : crée un compte gratuit sur gg.deals, puis Settings → API → copie ta clé dans les réglages de FreeKeep. FreeKeep surveille alors les prix « clé » de ~60 gros jeux populaires et des promos en cours. Il te prévient si un prix chute brutalement.

## 🎮 Switch

- **eShop** : moteur de recherche officiel de Nintendo Europe, plus l'API de prix Nintendo pour le prix exact en € et la date de fin. Ne sont gardés que les jeux bien classés dans les téléchargements Nintendo : top 500, ou top 1 500 s'ils sont vendus 20 € et plus. Les jeux Nintendo sont gardés dès -20 %. Les jeux inconnus bradés à -90 % sont écartés, et les jeux réservés à la Switch 2 aussi, sauf si tu les as demandés. Si seul le pack ou l'édition Deluxe est en promo, c'est son prix qui s'affiche, avec la mention « pack ou Deluxe ».
- **Physique et clés** : deals hot Dealabs (Amazon, Fnac, Leclerc, Micromania, Eneba…). Les accessoires et consoles sont écartés, et les jeux uniquement Switch 2 aussi, sauf si tu les as demandés. Les promos valables dans un seul magasin ne sont gardées que pour les départements que tu indiques (aucun par défaut).

## Notifications

- Nouveau jeu gratuit, et rappel quand il reste moins de 24 h.
- **Affaires exceptionnelles** : erreur de prix, chute soudaine, plus bas historique à -75 % et plus, deal hot à -60 % et plus, jeu Nintendo à -40 % et plus.

## Structure

```
extension/
├── background.js              # service worker : vérifs, notifs, badge, messages
├── src/
│   ├── config.js              # stores, sites, réglages par défaut
│   ├── merge.js               # fusion des jeux gratuits
│   ├── deals.js               # fusion des bons plans, chutes de prix, score, « exceptionnel »
│   ├── refresh-deals.js       # récupération des sources avec cache (ménage les API)
│   ├── store.js, util.js
│   └── sources/
│       ├── epic.js, steam.js, gamerpower.js      # gratuits
│       ├── cheapshark.js, ggdeals.js             # promos PC
│       ├── eshop.js                              # promos Switch
│       ├── dealabs.js                            # boîtes, clés, erreurs de prix, jeux offerts (RSS)
│       └── goglibrary.js                         # jeux GOG via la session gog.com
├── src/prefs.js, src/genres.js            # personnalisation : sections, exclusions, jeux possédés
├── src/sources/steamlibrary.js, steamapps.js  # bibliothèque/souhaits Steam, genres Steam/SteamSpy
├── onboarding/                # tutoriel de premier lancement
├── ui/                        # composants partagés (tutoriel + réglages)
├── content/claim.js           # clic assisté + détection « possédé »
├── popup/  options/  icons/
tests/
├── fixtures.js                # données calquées sur le format réel des API
└── unit.test.js               # 39 tests
```

## Tests

```bash
node --test tests/unit.test.js
```

Une partie des tests reprend des réponses relevées sur les vrais sites en novembre 2026.

La v4.0.0 a aussi été testée de bout en bout dans Chrome (36 vérifications), avec de fausses versions de toutes les API et pages des stores. Ces tests ne prouvent pas que les vrais sites répondent comme prévu. Les scénarios couverts :

- installation et tutoriel complet ;
- bibliothèque et liste de souhaits Steam, bibliothèque GOG via la session ;
- jeux Prime (Epic, Amazon Games, Legacy), Battle.net et Microsoft Store, Luna cloud ignoré si non coché ;
- filtres de genres et de mots-clés, tri Switch / Switch 2 ;
- menus qui s'adaptent quand on décoche une plateforme ;
- fusion des sources et tri des bons plans ;
- erreurs de prix, chute soudaine sur un site de clés, notifications ;
- filtres et masquage dans le popup ;
- récupération assistée (Steam, Epic, GOG) et sécurité sur le total Epic.

## Limites connues

- **CheapShark donne les prix en $ US.** La remise en % est fiable, mais le prix exact en € peut différer un peu. Avec une clé GG.deals, le prix « clé » est affiché en €.
- **Dealabs** : les flux par groupe ne donnent pas la température (le flux « Hot » la met en tête du titre, FreeKeep<3 la retire). FreeKeep s'appuie donc sur le flux « Hot » officiel et garde un historique de 14 jours. Un deal peut avoir expiré même s'il est encore listé.
- Dealabs, CheapShark, Nintendo et GG.deals peuvent changer leurs API. Si une source tombe, un bandeau le signale, l'État des sources passe en ✘ et les dernières données connues restent affichées.
- Navigateur fermé = pas de vérification : la suivante se fait au redémarrage.
- Les sites de clés sont du marché gris : prix plus bas, mais pas de garantie éditeur.
- **Amazon Prime n'a pas d'API publique** (la page des jeux Luna est générée en JavaScript). Les jeux Prime sont repérés via GamerPower et Dealabs : il peut en manquer, surtout les jeux Luna en cloud.
- **Steam** : la session donne les numéros des jeux, pas leurs noms. Si la lecture des noms échoue, un jeu Steam possédé peut rester affiché dans les annonces Dealabs.
- **GOG** : `getFilteredProducts` n'est pas une API documentée ; GOG peut la changer. En cas d'échec, la carte GOG passe en ⚠️ et le reste fonctionne.

---

Données : Epic Games Store, Steam, GOG, [GamerPower](https://www.gamerpower.com), [CheapShark](https://www.cheapshark.com), Nintendo eShop, [Dealabs](https://www.dealabs.com), [GG.deals](https://gg.deals). FreeKeep<3 n'est affilié à aucun de ces services.
