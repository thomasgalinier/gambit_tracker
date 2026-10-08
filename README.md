# Gambitracker

Extension Firefox / Chrome pour progresser au poker sur [gambit.com](https://www.gambit.com) :
enregistrement de tes mains, statistiques, revue de session, analyse GTO avec un vrai solveur,
quiz d'entraînement, et un coach en direct **uniquement contre les bots**.

Tout reste sur ton ordinateur : aucune donnée n'est envoyée ailleurs.

## Installation

### Firefox (128 ou plus)
1. Ouvre `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…** → choisis `extension/manifest.json`.
3. Sur gambit.com : icône puzzle 🧩 → Gambitracker → **Toujours autoriser sur gambit.com**.
4. Recharge l'onglet Gambit.

Le module temporaire disparaît à la fermeture de Firefox. Pour une installation permanente, voir [Signer pour Firefox](#signer-pour-firefox).

### Chrome
`chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée** → dossier `extension/`.

### Mettre à jour
Après une modification du code : **Recharger** dans `about:debugging` (ou `chrome://extensions`), puis recharge l'onglet Gambit.

## Utilisation

### La popup (icône de l'extension)
- Mains et résultat du jour, 5 dernières mains.
- Réglages du coach : activer/couper, mode « équité seulement », **ce qu'il affiche** (main, équité, cote, outs, SPR, conseil, grille préflop, profil des bots…), récap après chaque main, position du panneau.
- **Ouvrir l'analyse complète** → tableau de bord.

### Le coach en direct
Panneau sur la table, actif **seulement sur une table solo où tous les adversaires sont des bots**.
Il montre ta main, ton équité, la cote du pot, le conseil préflop (grilles à fréquences, « tapis ou fold » si ton tapis est court), la mini-grille de ta position et le profil des bots.

- Glisse le titre pour le déplacer, double-clic pour le remettre en place, **Alt+C** pour le cacher.
- Contre des humains (multijoueur, amis, tournois, sit & go) : **rien pendant la main**, seulement un récap une fois la main terminée (ton équité à chaque décision).

### Le tableau de bord
| Onglet | Contenu |
|---|---|
| Vue d'ensemble | Points à travailler, stats avec repères, courbe de résultat, progrès par session, stats Gambit, lexique |
| Revue de session | Une session = une partie (tournoi, sit & go, bots, table en ligne). Graphique (tapis en jetons pour les tournois), écarts préflop, gros pots analysés par le solveur, résumé des erreurs les plus coûteuses |
| Mains | Liste filtrable, détail action par action, **analyse GTO automatique**, replayer, notes, export PokerStars |
| Préflop | Grilles 13×13 à fréquences (ouverture, défense) avec tes mains jouées |
| Positions & bots | Résultats par position, fiche de chaque bot (stats, ce qu'il ouvre vraiment, comment l'exploiter) |
| Fuites | Analyse GTO de toutes tes mains d'un coup, spots où tu as mis des jetons sans l'équité |
| Entraînement | Quiz préflop (au hasard, sur tes erreurs, petits tapis), quiz après le flop sur tes mains analysées, calculatrice d'équité |

Boutons en haut : importer / sauvegarder (JSON), exporter au format PokerStars (pour GTO Wizard ou un tracker).
Une sauvegarde JSON est téléchargée automatiquement chaque semaine.

## Fair-play

L'aide en direct est bloquée dès qu'un humain est à la table. Le contrôle est dans `extension/live.js`, fonction `gate()` :

```js
if (!String(s.tableId).startsWith('solo:')) return 'table multijoueur ou tournoi';
if (others.some(x => !x.isBot)) return 'un humain est à la table';
```

Aucun réglage ne le contourne. Pour couper **toute** aide en direct (même contre les bots), mets dans `extension/config.js` :

```js
const COACH_ENABLED = false;
```

L'enregistrement des mains et l'analyse après la partie continuent de fonctionner.

## Comment ça marche

| Fichier | Rôle |
|---|---|
| `extension/hook.js` | S'exécute dans la page : intercepte le WebSocket et les réponses JSON de Gambit (jetons de connexion masqués) |
| `extension/relay.js` | Transforme les messages en mains et les stocke (`h<id>`), garde les stats Gambit (`f:…`) et l'historique Gambit (`handMeta`) |
| `extension/live.js` | Coach en direct, récap après la main |
| `extension/engine.js` | Tout le calcul : évaluateur de mains, équité (Monte Carlo), stats, grilles préflop, préparation des calculs du solveur, export PokerStars |
| `extension/dashboard.*` | Tableau de bord |
| `extension/solver-worker.js` + `extension/solver/` | Solveur GTO en WebAssembly, exécuté dans un Web Worker |
| `solver/` | Code Rust du solveur (voir `solver/README.md`) |

### Le solveur GTO
Basé sur [postflop-solver](https://github.com/b-inary/postflop-solver), compilé en WebAssembly.
River : instantané, turn : environ 5 s (40 s en « analyse précise »), flop : 2-3 min sur demande.
Les streets sont enchaînées : chaque calcul part des mains qui atteignent vraiment cette street.

### Limites
- Grilles préflop : approximation des solutions GTO publiées (6 joueurs, 100 BB) et grilles « tapis ou fold » sans antes ni ICM, pas une sortie de solveur.
- Le solveur ne calcule que les coups **à deux joueurs** ; les streets à 3+ joueurs ne sont pas analysées.
- Les pots limpés et les situations préflop inhabituelles utilisent des ranges approximatives (signalé dans l'analyse).

## Développement

```sh
node extension/test.js                 # tests (évaluateur, équité, grilles, préparation du solveur)
node extension/test.js export.json     # + parsing d'un ancien log brut
```

Recompiler le solveur : voir `solver/README.md` (Rust + `wasm-bindgen-cli 0.2.100`).

Paquet Firefox :
```sh
cd extension && zip -qr ../gambitracker.xpi manifest.json config.js hook.js relay.js live.js popup.html popup.js \
  engine.js dashboard.html dashboard.css dashboard.js solver-worker.js solver icons
```

### Signer pour Firefox
Installation permanente (signature « non listée », gratuite, pas de publication sur le store) :
1. Crée des clés API : https://addons.mozilla.org/developers/addon/api/key/
2. `AMO_JWT_ISSUER=user:xxx AMO_JWT_SECRET=yyy ./sign-firefox.sh`
3. Glisse le `.xpi` créé dans `signed/` sur une fenêtre Firefox.

## Licence

Le solveur (`postflop-solver`) est sous **AGPL-3.0** : si tu distribues l'extension, elle doit l'être sous AGPL-3.0 aussi.
