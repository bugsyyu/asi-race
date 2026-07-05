# ASI Race

![Capture d'écran du jeu ASI Race](docs/screenshots/gameplay.png)

Langues : [EN](README.md) | [JA](README.ja.md) | [FR](README.fr.md) | [ZH-CN](README.zh-CN.md) | [ZH-TW](README.zh-TW.md)

ASI Race est un jeu de stratégie en temps réel en 3D qui tourne dans le navigateur. Quatre factions inspirées de laboratoires d'IA se disputent le calcul, les données, les talents, l'influence politique, la confiance du public, la maîtrise du risque et l'alignement. La partie se termine lorsqu'une faction achève l'entraînement d'une ASI, ou lorsque tous les quartiers généraux adverses sont détruits.

> Ce projet est une parodie non officielle. Il n'est ni affilié, ni approuvé, ni sponsorisé par OpenAI, Anthropic, Google DeepMind, xAI ou un quelconque laboratoire réel. Les factions sont des abstractions ludiques inspirées d'impressions publiques et ne représentent aucune personne réelle.

## Lancer Depuis Les Sources

Ce dépôt contient le code source partagé du jeu navigateur extrait des paquets générés par Fable. `vendor/three.module.js` est inclus, donc la version source fonctionne directement avec n'importe quel serveur statique local.

```bash
python3 -m http.server 8000
# Ouvrir http://localhost:8000
```

Lancer les vérifications de simulation sans interface :

```bash
npm test
# Équivalent à node test/headless.mjs
```

## Téléchargements

La publication GitHub `v1.1.0` fournit les deux archives par plateforme, reconstruites depuis les sources actuelles par le workflow GitHub Actions `release` (`packaging/build-zips.sh`), avec tout le contenu de [CHANGELOG.md](CHANGELOG.md) :

- `asi-race-mac-zh.zip` : paquet macOS avec une application et un script de lancement.
- `asi-race-win-zh.zip` : paquet Windows avec un lanceur en ligne de commande et un lanceur de serveur local PowerShell.

Les deux archives embarquent le moteur Three.js : elles fonctionnent entièrement hors ligne dès l'extraction ; si le fichier venait à manquer, les lanceurs peuvent toujours le récupérer lors d'un démarrage en ligne. La publication `v1.0.0` conserve les archives de la version initiale.

## Contrôles

| Entrée | Action |
| --- | --- |
| Balayage à deux doigts | Déplacer la caméra |
| Pincement / ctrl+molette | Zoomer |
| Toucher à deux doigts / clic droit | Commande intelligente : se déplacer, récolter, attaquer, rallier |
| Clic / sélection par cadre / shift | Sélectionner, sélectionner une zone, ajouter à la sélection |
| Q / E, WASD / flèches, H | Tourner, déplacer, centrer sur le quartier général |
| [ / ] ou alt+molette | Inclinaison de la caméra : plan de bataille proche de l'horizon ou vue plongeante |
| ctrl+1-4 / 1-4 | Enregistrer / rappeler des groupes |
| A + clic | Attaque-déplacement : l'escouade nettoie tout ennemi en chemin |
| Tab | Passer d'un chercheur inactif à l'autre (avec la caméra) |
| Espace | Aller à la dernière zone attaquée |
| P, F, M, Esc, ? / F1 | Pause, vitesse double, muet, annuler, manuel |

Le manuel intégré comporte cinq pages sur l'objectif, les contrôles, l'économie, la politique et la confiance, ainsi que les fins possibles.

## Système De Jeu

- Le calcul vient du quartier général, des centres de données et des grappes GPU capturables.
- Les données sont récoltées par les chercheurs sur des noeuds de la carte ; les laboratoires avancés peuvent produire des données synthétiques automatiquement.
- L'influence vient du lobbying au capitole et sert aux contrôles d'exportation, aux subventions de calcul, aux enquêtes réglementaires et aux campagnes de relations publiques.
- Les talents fixent la limite d'unités ; la confiance modifie le coût de recrutement et le risque de débauchage.
- Accélérer la recherche augmente le risque, tandis que la recherche d'alignement réduit la pression d'accident et influence la fin.
- Deux éclairages de bataille au choix au lancement : ☀ jour (prairie dorée baignée de soleil dans un vide sombre, campus blancs) et 🌆 crépuscule (le rendu d'origine).
- La présentation vise un réalisme stylisé cinématographique : étalonnage filmique (désaturation, vignettage, grain), terrain photo-texturé avec de vrais terrassements en déblai-remblai sous chaque site de construction, plateformes en métal usiné sombre avec bornes lumineuses aux couleurs de faction à la place des socles-plateaux, enveloppes de bâtiments refaites d'après la vidéo de référence d'origine — panneaux d'alliage blanc nacré et verre en bandeau avec reflets d'environnement, plus de béton brut — façades portant des détails à échelle humaine (échelles d'accès, gouttières, grilles d'admission), un vocabulaire architectural proche-futur composé de nombreuses références réelles puis poussé au-delà, et des personnages animés par squelette aux proportions adultes.
- Une météo dynamique traverse le champ de bataille : les ombres des nuages balaient le sol, les averses voilent le soleil derrière un rideau de pluie, puis la lumière dorée revient ; l'étalonnage de jour est réglé radieux — lumière clé chaude, split-toning orange-sarcelle, hautes lumières scintillantes.
- Le HUD inférieur est une console de commandement RTS professionnelle : une station carte tactique avec équerres d'angle et balayage de capteur, une station d'informations de commandement avec plaque de faction, barre de vie segmentée et cases de file de production, et un pupitre d'ordres aux touches biseautées avec capuchons de raccourci, bandeaux de coût et états verrouillé/ressources insuffisantes — trois stations en plaques blindées chanfreinées rivetées sur un rail de châssis pleine largeur, teintées à la livrée de votre faction.
- Le terrain est un système de jeu : des murailles de mesa coupent les couloirs extérieurs et forcent les armées à passer par les cols des grappes GPU ; les pentes ralentissent, les flancs abrupts refusent chemins et constructions ; les unités en hauteur voient plus loin et frappent ~30 % plus fort (attaquer vers le haut frappe plus faiblement).
- Une couche de gestion à la Age of Empires : des technologies économiques uniques à rechercher dans chaque bâtiment (interconnexion optique, pipelines de données, exercices red-team, supervision des processus…), plus un marché au comptant du calcul avec glissement au QG pour les échanges d'urgence.
- Les IA rivales suivent le même manuel : elles achètent leurs technologies selon leur personnalité, commercent au marché, lisent votre armée pour entraîner des contres, escortent leurs mineurs, replient leurs raids épuisés et fortifient l'axe de votre dernière attaque.
- Une méta-économie industrielle tourne à côté de la guerre : cours de bourse et augmentations de capital par labo, un indice matériel secoué par les bulles crypto, les pénuries et les sorties open-source, un mode cloud (louer son calcul contre données + influence en faisant baisser le matériel pour tous), et des chercheurs stars parodiques — qui démissionnent, passent chez le rival, se font débaucher, ou fondent sur la carte des startups que chacun peut racheter avant leur IPO.
- La fin de partie est l'Émergence : un entraînement vivant s'éveille en cinq étapes ancrées dont le tempérament lit votre alignement courant — l'auto-amélioration récursive fait fondre l'horloge, la commercialisation des checkpoints finance le labo et casse les prix de revente de calcul des rivaux, des campagnes narratives massives (ou des évaluations de sécurité publiées) infléchissent la confiance, une ruée des talents vers le vainqueur (plus des taupes achetées) assèche les rivaux, et l'acte final est soit une divulgation défensive, soit un accaparement légal mais impitoyable de la capacité du réseau électrique ; deux entraînements simultanés basculent en overclocking compétitif.
- Le brouillard de guerre couvre le champ de bataille : unités et bâtiments fournissent la vision, les zones explorées s'assombrissent en un souvenir qui ne garde que le dernier état observé des bâtiments ennemis ; la mini-carte suit le brouillard, seul le pilier de lumière de l'entraînement ASI reste visible de partout.
- La victoire passe par Gen-2, Gen-3, Gen-4 / AGI puis l'entraînement ASI, ou par la destruction de tous les quartiers généraux adverses.

Les factions jouables s'inspirent d'OpenAI, Anthropic, Google DeepMind et xAI, chacune avec un bonus économique ou sécuritaire distinct.

## Structure Du Projet

```text
index.html            Point d'entrée du navigateur
css/                  Styles du HUD, de l'écran de départ et des surcouches de bataille
js/sim/               Couche de simulation déterministe, indépendante du DOM et de three.js
js/view/              Couche de rendu three.js, terrain, bâtiments, personnages, effets
js/ui/                HUD et didacticiel intégré
js/audio/             Effets WebAudio et musique d'ambiance
js/shared/            Fonctions partagées par la simulation et le rendu
test/headless.mjs     Suite de tests de simulation pour Node
vendor/               three.js v0.170.0 intégré
packaging/            Sources des lanceurs extraits des paquets macOS et Windows
```

La simulation avance par pas fixes de 0,1 seconde. Le rendu lit l'état et joue des retours visuels interpolés. Les joueurs IA utilisent la même API de commandes que le joueur humain.

## Traduction De L'Invite Originale

```text
Construis-moi un jeu de stratégie en temps réel 3D jouable dans le navigateur,
avec une vue plongeante à la Age of Empires, comme métaphore de la course de
l'IA vers la superintelligence. Les factions sont OpenAI, Anthropic,
Google DeepMind et xAI, chacune avec une identité inspirée de sa marque et un
bonus adapté à sa personnalité.

Ne te contente pas de changer l'habillage d'un RTS : invente des mécanismes
issus de la métaphore. Pense à ce sur quoi ces laboratoires se font vraiment
concurrence, comme le calcul, les données, les talents, les faveurs publiques
et la perception du public, puis transforme ces éléments en économie, progression
technologique et condition de victoire. Les laboratoires rivaux doivent être de
vrais adversaires IA qui font la course contre le joueur, et toute la partie doit
se terminer quand quelqu'un atteint la superintelligence en premier.

Utilise Three.js, avec des modules ES simples, sans étape de build et avec un
serveur statique local. Le jeu doit être entièrement construit à partir de
vraies ressources téléchargées, de haute qualité, jamais générées par IA. Les
personnages doivent être des modèles riggés qui marchent, travaillent et
combattent vraiment avec des animations squelettiques. Rends l'ensemble
cinématographique et percutant : éclairage dramatique, ombres réelles, effets
de retour pour chaque action, et un paysage sonore complet avec de vrais effets
pour le combat, la construction et les alertes, plus une musique de fond calme.

Prévois des contrôles pensés d'abord pour le pavé tactile, un HUD propre en
surcouche et un guide intégré. Garde la simulation séparée du rendu, et vérifie
chaque système en direct dans le navigateur pendant la construction plutôt qu'à
la fin.
```

## Note Sur Les Ressources

L'invite originale demandait de vraies ressources téléchargées. La sortie actuelle de Fable ne dépend en pratique que du module Three.js téléchargé ; les bâtiments, la géométrie des personnages, les poses d'animation squelettique, les textures, les effets sonores et la musique d'ambiance sont générés procéduralement par le code du projet. En complément, le dépôt inclut désormais deux jeux de textures de terrain réelles CC0 de Poly Haven sous `assets/textures/` (diffuse + normale d'herbe/roche aérienne, diffuse de boue sèche) utilisés par le rendu du sol ; le reste des ressources demeure procédural. Ce dépôt conserve cet état d'implémentation et fixe Three.js à `0.170.0` afin que la version source fonctionne directement.
