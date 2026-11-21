# FreeKeep v2.1 : jeux gratuits à vie & vrais bons plans

Extension Chrome / Opera GX / Edge / Brave (Manifest V3) organisée en trois sections.

| Section | Contenu |
|---|---|
| 🎁 **Gratuits** | Jeux PC offerts à garder à vie : Epic, Steam, GOG, Ubisoft, **et les drops ponctuels** (Alienware Arena, Fanatical, Humble Bundle, IndieGala, Prime Gaming, itch.io…) |
| 💻 **Promos PC** | Seulement les **gros jeux bien notés** et les **pépites** très appréciées à grosse remise, sur les stores officiels et les sites de clés |
| 🎮 **Switch** | Grosses promos **eShop** (jeux jouables sur Switch 1), **jeux en boîte** (Amazon, Fnac, Leclerc…) et **clés** |

## Installation

1. Dézippe l'archive. Range le dossier quelque part de fixe, par exemple `Documents\FreeKeep` : le navigateur le relit à chaque démarrage.
2. Ouvre `chrome://extensions` (ou `opera://extensions`, `edge://extensions`).
3. Active le **Mode développeur**.
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`extension/`**.
5. Épingle l'icône 🎁.

**Mise à jour depuis la v1** : remplace le contenu du dossier `extension/`, puis clique sur ↻ (Recharger) sur la carte FreeKeep. Ton historique est conservé.

## Vérifications automatiques

- Les vérifications interrogent les vrais sites. Elles tournent en arrière-plan, même popup fermé, tant que le navigateur est ouvert.
- **Fréquence** : toutes les heures par défaut, réglable de 30 min à 24 h. Une vérification se lance aussi :
  - à l'installation ;
  - au démarrage du navigateur ;
  - à l'ouverture du popup si la dernière date de plus de 30 min.
- **Réglages → État des sources** : chaque source y est affichée en direct (✔ nombre de résultats ou ✘ erreur), avec l'heure de la prochaine vérification et un bouton « Vérifier maintenant ».
- Pour ne pas se faire bloquer par les API, chaque source garde ses résultats un minimum de temps : 15 min pour CheapShark et l'eShop, 10 min pour Dealabs, 50 min pour GG.deals.

## 🎁 Gratuits

- Sources : API officielle Epic, recherche Steam (-100 %) et [GamerPower](https://www.gamerpower.com), qui recense tous les giveaways de jeux PC.
- Le site qui organise le giveaway est affiché, par exemple « via Alienware Arena ». Ces sites demandent parfois un compte.
- Le bouton **Récupérer** ouvre la page du store et clique sur « Obtenir » pour toi. Sur Epic, la commande n'est validée que si le total est à 0 €. Les captchas restent à faire toi-même.
- Les jeux que tu possèdes déjà sont détectés : sur Steam via ta session, sur les stores quand la page affiche « Dans la bibliothèque ».

## 💻 Promos PC : que des pépites

| Source | Ce qu'elle apporte |
|---|---|
| [CheapShark](https://www.cheapshark.com) | Promos sur 30+ stores officiels (Steam, GOG, Humble, Fanatical, GMG, Gamesplanet…), avec la note Metacritic et les avis Steam |
| [Dealabs](https://www.dealabs.com) | Deals **hot** validés par la communauté, y compris sur les sites de clés (Eneba, Instant Gaming, G2A…), et **erreurs de prix** |
| [GG.deals](https://gg.deals) *(facultatif)* | Prix des **sites de clés** en euros, plus bas historiques, surveillance des gros jeux |

Ce qui est gardé (seuils réglables) :
- **Gros jeu** : vendu 29 $ ou plus, Metacritic 75+ ou avis Steam 80 %+, remise d'au moins 60 %.
- **💎 Pépite** : avis Steam 90 %+ (3 000 avis minimum), remise d'au moins 70 %.

Badges : ⚠️ erreur de prix · 📉 chute soudaine (-30 % depuis la vérif précédente) · 🏆 plus bas historique · 🔥 hot Dealabs · 🔑 prix sur les sites de clés.

**Activer les sites de clés** : crée un compte gratuit sur gg.deals, puis Settings → API → copie ta clé dans les réglages de FreeKeep. FreeKeep surveille alors les prix « clé » de ~60 gros jeux populaires et des promos en cours. Il te prévient si un prix chute brutalement.

## 🎮 Switch

- **eShop** : moteur de recherche officiel de Nintendo Europe, plus l'API de prix Nintendo pour le prix exact en € et la date de fin. Ne sont gardés que les jeux populaires ou vendus 20 € et plus. Les jeux Nintendo sont gardés dès -20 %. Les petits jeux inconnus bradés à -90 % sont écartés, ainsi que les jeux réservés à la Switch 2.
- **Physique et clés** : deals hot Dealabs (Amazon, Fnac, Leclerc, Micromania, Eneba…). Les accessoires, consoles et jeux uniquement Switch 2 sont écartés. Les promos valables dans un seul magasin ne sont gardées que pour tes départements (**80** par défaut, modifiable).

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
│       └── dealabs.js                            # boîtes, clés, erreurs de prix (RSS)
├── content/claim.js           # clic assisté + détection « possédé »
├── popup/  options/  icons/
tests/
├── fixtures.js                # données calquées sur le format réel des API
└── unit.test.js               # 17 tests
```

## Tests

```bash
node --test tests/unit.test.js
```

L'extension a aussi été testée de bout en bout dans Chrome (33 vérifications), avec de fausses versions de toutes les API et pages des stores. Les scénarios couverts :

- fusion des sources et tri des bons plans ;
- erreurs de prix, chute soudaine sur un site de clés, notifications ;
- filtres et masquage dans le popup ;
- récupération assistée (Steam, Epic, GOG) et sécurité sur le total Epic.

## Limites connues

- **CheapShark donne les prix en $ US.** La remise en % est fiable, mais le prix exact en € peut différer un peu. Avec une clé GG.deals, le prix « clé » est affiché en €.
- **Dealabs** : le flux RSS ne donne pas la température. FreeKeep s'appuie donc sur le flux « Hot » officiel et garde un historique de 14 jours. Un deal peut avoir expiré même s'il est encore listé.
- Dealabs, CheapShark, Nintendo et GG.deals peuvent changer leurs API. Si une source tombe, un bandeau le signale, l'État des sources passe en ✘ et les dernières données connues restent affichées.
- Navigateur fermé = pas de vérification : la suivante se fait au redémarrage.
- Les sites de clés sont du marché gris : prix plus bas, mais pas de garantie éditeur.

---

Données : Epic Games Store, Steam, [GamerPower](https://www.gamerpower.com), [CheapShark](https://www.cheapshark.com), Nintendo eShop, [Dealabs](https://www.dealabs.com), [GG.deals](https://gg.deals). FreeKeep n'est affilié à aucun de ces services.
