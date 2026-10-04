# PixelForge — Éditeur pixel art, animations et tilemaps

PixelForge est une application web pour créer du pixel art professionnel :
**génération de sprites et d'animations à partir de prompt**, dessin au pixel
près, calques, animations image par image, tilemaps pour vos jeux vidéo, et
exports vers tous les formats utiles (PNG, GIF, spritesheet, JSON Tiled).

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
```

## Fonctionnalités

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
```

Les opérations de dessin sont testées par Vitest (31 tests) : remplissage,
formes, composition, historique, sauvegarde/restauration du projet.

## Pistes d'amélioration

- Outil sélection : déplacer/copier-coller la zone sélectionnée.
- Transformation : retournement, rotation, décalage de calque.
- Mode symétrie (miroir horizontal/vertical).
- Palette d'animation avec tag/boucles (A/B tags comme Aseprite).
- Export de tilemaps animées et support du format `LDtk`.
- Raccourcis personnalisables et thème clair.
