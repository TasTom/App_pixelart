# PixelForge — Éditeur pixel art, animations et tilemaps

PixelForge est une application web pour créer du pixel art professionnel :
**génération de sprites et d'animations à partir de prompt** (moteur local,
serveur IA local ou API en ligne), dessin au pixel près, calques, animations
image par image, tilemaps pour vos jeux vidéo, et exports vers tous les
formats utiles (PNG, GIF, spritesheet, JSON Tiled).

![stack](https://img.shields.io/badge/React_19-TypeScript-Vite-7c6cf0)

## Démarrage

```bash
npm install
npm run dev        # ouvre http://localhost:5173
```

Autres commandes :

```bash
npm run build      # build de production (dossier dist/)
npm run preview    # sert le build de production
npm test           # tests unitaires (Vitest)
npm run lint       # analyse du code (oxlint)
npm run mock:sd    # serveur de test A1111 + ComfyUI (validation sans GPU)
```

## Fonctionnalités

### ✦ Génération de sprites par prompt (onglet « Génération »)
- **Décrivez** votre sprite (« un petit dragon bleu avec des ailes »,
  « chevalier en armure dorée », « épée magique violette »…) : le prompt est
  analysé (type, couleurs, détails) puis transformé en sprite.
- **Types reconnus** : personnages et créatures (ailes, cornes, queue,
  chapeau, arme, bouclier…), animaux, slimes et fantômes, objets (épée,
  potion, coffre, clé, bouclier, gemme, parchemin, pièce), nature (arbre,
  rocher, champignon, fleur), bâtiments (maison, tour) et tuiles de terrain
  (herbe, pierre, eau, sable, neige, lave).
- **Animations en un clic** : marche, repos, attaque, saut — 2 à 8 images.
- **Styles** : RPG 16-bit, Game Boy (4 couleurs), NES 8-bit, Arcade néon,
  Cartoon — ou « Auto » selon le prompt.
- **Variantes** : jusqu'à 4 résultats par génération. Tailles 16×16 à 64×64.
- **File d'attente** : les demandes s'enchaînent (un serveur local génère une
  image à la fois) avec **barre de progression** — y compris l'avancement
  réel du serveur (Automatic1111) — annulation d'une demande ou de toutes,
  et nettoyage des demandes terminées. Vous pouvez continuer à dessiner
  pendant la génération.
- **Trois moteurs** :
  - *Générateur local* : hors-ligne, gratuit, instantané et reproductible
    (même prompt + graine ⇒ même sprite) ;
  - *Serveur IA local* : connexion à **ComfyUI** ou **Automatic1111 / Forge**
    installé sur votre PC — de vrais modèles open source (SD 1.5, SDXL,
    Flux + LoRA pixel art), sans clé API et sans envoi de données ;
  - *IA en ligne* (clé API personnelle, ex. OpenAI `gpt-image-1`,
    `dall-e-3`) : l'image est automatiquement convertie en pixel art
    (réduction de taille, suppression de fond, quantification de palette).
- Chaque résultat s'insère en un clic : **nouveau document** (animation
  comprise) ou **nouveau calque** dans le document courant.

#### Brancher un serveur IA local (ComfyUI / Automatic1111)

1. Lancez votre serveur avec l'API et le CORS activés :

   | Serveur | Commande de lancement |
   |---|---|
   | Automatic1111 / Forge | `./webui.sh --api --cors-allow-origins=*`<br />(Windows : `webui-user.bat` avec `set COMMANDLINE_ARGS=--api --cors-allow-origins=*`) |
   | ComfyUI | `python main.py --enable-cors-header` |

2. Dans PixelForge : moteur **« Serveur IA local »**, choisissez le type de
   serveur, vérifiez l'URL (A1111 : `http://127.0.0.1:7860`,
   ComfyUI : `http://127.0.0.1:8188`), puis cliquez sur
   **« Tester la connexion »** : les modèles, samplers et planificateurs
   disponibles sont récupérés automatiquement.
3. Réglez les paramètres (étapes, CFG, sampler, résolution, prompt négatif)
   et générez. Pour un rendu pixel art net, chargez un modèle spécialisé
   (ex. *PixelArt-Diffusion*, ou SDXL + LoRA *pixel-art-xl*) :
   - **ComfyUI** : les LoRA du dossier `models/loras` sont détectées et
     appliquées via un nœud `LoraLoader` (sélecteur + poids) ;
   - **Automatic1111 / Forge** : le champ **LoRA** ajoute automatiquement
     `<lora:nom:poids>` au prompt.

Pendant la génération, la **barre de progression** affiche l'avancement
réel du serveur (via `/sdapi/v1/progress` sur A1111, temps écoulé sur
ComfyUI) ; chaque demande peut être annulée individuellement.

Seul le prompt enrichi part vers le serveur ; les images reviennent en local
et sont pixelisées par l'application (fond transparent, palette réduite).

> Pas de GPU sous la main ? `npm run mock:sd` lance un serveur de test qui
> imite les deux API (A1111 et ComfyUI) pour valider la connexion.

### Canvas
- Formats prédéfinis : 16×16, 32×32, 64×64, 128×128, 256×256, 512×512,
  ou dimensions personnalisées (jusqu'à 2048×2048).
- Zoom à la molette centré sur le pointeur, déplacement (espace, molette
  centrale ou outil « Déplacement »), bouton « Ajuster » pour cadrer.
- Grille de pixels (visible au-delà de 600 %), damier de transparence,
  grille de tiles bleue quand un calque tilemap est actif.

### Outils
| Outil | Raccourci | Rôle |
|---|---|---|
| Stylo | `B` | Dessin au pixel (taille de brosse 1 à 16) |
| Gomme | `E` | Efface (transparence) |
| Remplissage | `G` | Pot de peinture (flood fill) |
| Ligne | `L` | Ligne droite (Shift : angles multiples de 45°) |
| Rectangle | `R` | Contour ou forme remplie (Shift : carré parfait) |
| Ellipse | `O` | Contour ou forme remplie (Shift : cercle parfait) |
| Pipette | `I` | Reprend la couleur sous le curseur |
| Sélection | `M` | Sélection rectangulaire, `Suppr` efface la zone |
| Déplacement | `H` | Déplace la vue |

- Clic gauche : couleur primaire · Clic droit : couleur secondaire.
- `X` : inverse les deux couleurs · `[` / `]` : taille de brosse.
- `Ctrl+Z` / `Ctrl+Y` : annuler / rétablir (100 niveaux).
- `Échap` : annule le trait en cours ou la sélection.

### Calques
- Calques raster classiques + calques **tilemap** (grille de tiles).
- Visibilité, opacité, verrouillage, renommage (double-clic), duplication,
  réorganisation (flèches ↑ ↓).

### Animation
- Timeline avec miniatures, durée par image (ms), duplication et
  réorganisation des images.
- Lecture / pause en boucle, pelure d'oignon (images précédente et suivante).
- Navigation rapide : `←` / `→` entre les images.

### Tilemap et tileset
- Tileset intégré : création, duplication et suppression de tiles
  (taille 8, 16 ou 32 px choisie à la création du document).
- **Double-clic sur une tile** : mode édition sur le grand canvas (les outils
  de dessin fonctionnent directement sur la tile).
- Sur un calque tilemap actif, le stylo pose la tile sélectionnée (clic
  droit : effacer la cellule), le remplissage remplit les zones de tiles.
- Export **JSON Tiled 1.10** + tileset PNG, directement importable dans
  Tiled, Godot, Phaser, Unity (via Tiled), etc.

### Exports
- **PNG** de l'image courante (échelle 1× à 8×).
- **Planche de sprites** PNG + JSON (métadonnées de cadrage et durées).
- **GIF animé** avec transparence et durées par image.
- **Tilemap JSON Tiled** + PNG du tileset.
- **Projet** `.pixelforge.json` : sauvegarde complète (calques, images,
  tileset, palette) réouvrable via « Ouvrir ».

Une **sauvegarde automatique** conserve votre travail dans le navigateur
(localStorage) : vous retrouvez votre dessin après un rechargement de page.

## Palettes

Six palettes prédéfinies (Douce 16, PICO-8, Game Boy, Échelle de gris,
Arcade 16, Nature) + gestion de la palette du document : ajout/retrait de
couleurs, réorganisation par clic (primaire) et clic droit (secondaire).

## Architecture du code

```
src/
├── types.ts              # Modèle : Doc, calques, tiles, historique
├── gen/
│   ├── prompt.ts         # Analyse du prompt (type, couleurs, style)
│   ├── procedural.ts     # Génération locale de sprites et animations
│   ├── pixelate.ts       # Image → pixel art (taille, fond, palette)
│   ├── runner.ts         # Exécution d'une génération (progression, annulation)
│   ├── queue.ts          # File d'attente (une génération à la fois)
│   ├── localServer.ts    # Serveur IA local (ComfyUI / Automatic1111)
│   └── ai.ts             # IA en ligne (API compatible OpenAI)
├── core/
│   ├── document.ts       # Création/clonage/redimensionnement du document
│   ├── drawOps.ts        # Brosse, ligne, rectangle, ellipse, remplissage
│   ├── compose.ts        # Fusion des calques (exports, miniatures)
│   └── history.ts        # Undo/redo par patches
├── state/store.ts        # Store Zustand (document + UI + historique)
├── canvas/
│   ├── compositor.ts     # Rendu des calques vers canvas
│   └── paintController.ts# Traits de dessin (avant/après → historique)
├── export/exporters.ts   # PNG, spritesheet, GIF, Tiled, projet
└── components/           # Interface (React)
scripts/
└── mock-sd-server.mjs    # Serveur de test A1111 + ComfyUI (sans GPU)
```

Les opérations de dessin **et de génération** sont testées par Vitest
(83 tests) : remplissage, formes, composition, historique,
sauvegarde/restauration du projet, analyse de prompt, sprites
déterministes, animations, conversion image → pixel art, payloads et
workflows des serveurs IA locaux (dont le nœud LoRA), file d'attente
(ordre, progression, annulation, erreurs).

## Pistes d'amélioration

- File d'attente : réordonnancement par glisser-déposer.
- Connexion WebSocket à ComfyUI pour un pourcentage de progression exact.
- Outil sélection : déplacer/copier-coller la zone sélectionnée.
- Transformation : retournement, rotation, décalage de calque.
- Mode symétrie (miroir horizontal/vertical).
- Palette d'animation avec tag/boucles (A/B tags comme Aseprite).
- Export de tilemaps animées et support du format `LDtk`.
