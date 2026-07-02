# ASI Race

![Capture d'écran du jeu ASI Race](docs/screenshots/gameplay.png)

Langues : [EN](README.md) | [ZH-CN](README.zh-CN.md) | [ZH-TW](README.zh-TW.md) | [JA](README.ja.md) | [FR](README.fr.md)

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

La publication GitHub `v1.0.0` contient deux archives originales par plateforme :

- `asi-race-mac-zh.zip` : paquet macOS avec une application et un script de lancement.
- `asi-race-win-zh.zip` : paquet Windows avec un lanceur en ligne de commande et un lanceur de serveur local PowerShell.

Si `three.module.js` manque, les deux lanceurs le téléchargent automatiquement au premier démarrage en ligne. Ensuite, le jeu peut fonctionner hors ligne. La version source du dépôt contient déjà ce fichier.

## Contrôles

| Entrée | Action |
| --- | --- |
| Balayage à deux doigts | Déplacer la caméra |
| Pincement / ctrl+molette | Zoomer |
| Toucher à deux doigts / clic droit | Commande intelligente : se déplacer, récolter, attaquer, rallier |
| Clic / sélection par cadre / shift | Sélectionner, sélectionner une zone, ajouter à la sélection |
| Q / E, WASD / flèches, H | Tourner, déplacer, centrer sur le quartier général |
| ctrl+1-4 / 1-4 | Enregistrer / rappeler des groupes |
| Espace | Aller à la dernière zone attaquée |
| P, F, M, Esc, ? / F1 | Pause, vitesse double, muet, annuler, manuel |

Le manuel intégré comporte cinq pages sur l'objectif, les contrôles, l'économie, la politique et la confiance, ainsi que les fins possibles.

## Système De Jeu

- Le calcul vient du quartier général, des centres de données et des grappes GPU capturables.
- Les données sont récoltées par les chercheurs sur des noeuds de la carte ; les laboratoires avancés peuvent produire des données synthétiques automatiquement.
- L'influence vient du lobbying au capitole et sert aux contrôles d'exportation, aux subventions de calcul, aux enquêtes réglementaires et aux campagnes de relations publiques.
- Les talents fixent la limite d'unités ; la confiance modifie le coût de recrutement et le risque de débauchage.
- Accélérer la recherche augmente le risque, tandis que la recherche d'alignement réduit la pression d'accident et influence la fin.
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

L'invite originale demandait de vraies ressources téléchargées. La sortie actuelle de Fable ne dépend en pratique que du module Three.js téléchargé ; les bâtiments, la géométrie des personnages, les poses d'animation squelettique, les textures, les effets sonores et la musique d'ambiance sont générés procéduralement par le code du projet. Ce dépôt conserve cet état d'implémentation et fixe Three.js à `0.170.0` afin que la version source fonctionne directement.
