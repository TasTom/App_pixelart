# PixelForge — Éditeur pixel art, animations et tilemaps

PixelForge est une application web pour créer du pixel art professionnel :
**génération de sprites et d'animations à partir de prompt** (serveur IA local
ou API en ligne), dessin au pixel près, calques, animations image par image,
tilemaps pour vos jeux vidéo, et exports vers tous les formats utiles
(PNG, GIF, spritesheet, JSON Tiled).

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
npm run comfy      # démarre ComfyUI (API + CORS) pour la génération locale
npm run check:pixel-model   # vérifie que le profil de modèles est complet
npm run mock:sd    # serveur de test A1111 + ComfyUI (validation sans GPU)
npm run validate:pixel-model   # régénère les exemples de l'interface
```

## Fonctionnalités

### ✦ Génération de sprites par prompt (onglet « Génération »)
- **Décrivez** votre sprite (« un petit dragon bleu avec des ailes »,
  « chevalier en armure dorée », « épée magique violette »…) : le prompt est
  enrichi puis envoyé au moteur choisi.
- **Animations en un clic** : marche, repos, attaque, saut — 2 à 8 images.
  Sur serveur local, l'animation utilise l'**img2img séquentiel** : la première
  image est créée en texte vers image, puis chaque pose est générée depuis
  l'image précédente avec un débruitage partiel. Le personnage garde donc son
  identité, ses couleurs et son alignement d'une image à l'autre.
- **Styles** : RPG 16-bit, Game Boy (4 couleurs), NES 8-bit, Arcade néon,
  Cartoon — ou « Auto » selon le prompt.
- **Variantes** : jusqu'à 4 résultats par génération. Tailles 16×16 à 256×256.
- **Vue** : top-down haute (jeux vus de dessus, tuiles), top-down basse
  (jeux 3/4 comme Zelda ou Stardew) ou côté (plateforme). Le cadrage est
  explicitement décrit dans le prompt, ce qui change radicalement le rendu.
- **File d'attente** : les demandes s'enchaînent (un serveur local génère une
  image à la fois) avec **barre de progression** — y compris l'avancement
  réel du serveur (Automatic1111) — annulation d'une demande ou de toutes,
  et nettoyage des demandes terminées. Vous pouvez continuer à dessiner
  pendant la génération.
- **Deux moteurs** :
  - *Serveur IA local* : connexion à **ComfyUI** ou **Automatic1111 / Forge**
    installé sur votre PC — de vrais modèles open source (SD 1.5, SDXL,
    Flux + LoRA pixel art), sans clé API et sans envoi de données ;
  - *IA en ligne* (clé API personnelle) : GPT Image 2.5 Sunburst par défaut,
    GPT Image 2.5 Flare ou GPT Image 2, avec une qualité réglable de brouillon
    à maximale pour les modèles 2.5. Les préférences DALL·E 3 enregistrées
    sont migrées, ce modèle ayant été retiré. Le PNG est demandé avec un
    véritable canal alpha pour les sprites isolés.
- Chaque résultat s'insère en un clic : **nouveau document** (animation
  comprise) ou **nouveau calque** dans le document courant.

#### Obtenir un résultat fidèle au prompt

- Décrivez d'abord le sujet principal, puis ses couleurs, ses accessoires,
  sa pose et la vue souhaitée. Exemple : « chevalier en armure dorée,
  épée bleue dans la main droite, bouclier rouge dans la main gauche,
  vue de face ». Le prompt original reste dans les instructions envoyées.
- Choisissez la **vue** correspondant à votre jeu. C'est le réglage qui
  influence le plus le cadrage : une tuile de terrain se génère vue de
  dessus, un personnage de jeu 3/4 en top-down basse.
- Utilisez **64 ou 128 px**, **32 à 48 couleurs** et **Pixels nets** pour
  conserver les détails. Les petits formats simplifient forcément l'image.
- Choisissez **Sprite isolé**, **Scène / illustration** ou **Tuile de terrain**.
  En mode Auto, une scène ou une tuile conserve son fond ; le sprite est
  détouré. Le réglage **Fond** permet de forcer ce comportement.
- Pour une API en ligne, commencez en qualité **Haute**, puis comparez avec
  **Très haute** ou **Maximale**. Chaque image consomme du quota API ; coût
  et durée dépendent du modèle et de la qualité.
- Gardez la palette du document désactivée si elle ne contient pas les
  couleurs décrites. Le style Game Boy impose ses quatre tons verts.
- Sur un serveur SD local, le choix du checkpoint et de la LoRA reste
  déterminant. Un prompt en anglais peut être plus adapté à ces modèles.
- **Voir le prompt envoyé au moteur** montre les instructions positives,
  les déclencheurs et balises LoRA, ainsi que le prompt négatif du serveur.
- Une **graine** explicite reproduit la requête du serveur local.

#### Comment fonctionne l'animation

Générer chaque image indépendamment donne des personnages différents à chaque
frame. PixelForge enchaîne donc les images :

1. **Image 1** — texte vers image classique, avec la première pose du cycle.
2. **Images 2 à N** — *img2img* depuis l'image précédente : les pixels de départ
   sont encodés en latents, puis seul un débruitage partiel est appliqué
   (`denoise` ≈ 0,62). Le prompt décrit la pose suivante.

Le taux de débruitage est réglable dans l'interface avec le curseur
**« Stabilité de l'animation »** (0,62 par défaut) :

| Valeur | Effet |
|--------|-------|
| 0,3 – 0,5 | poses subtiles, très stable — idéal pour un repos |
| 0,6 – 0,7 | bon équilibre, convient à la marche et à l'attaque |
| 0,8 – 0,95 | poses très différentes, risque de perdre l'identité |

Techniquement, `Flux2Scheduler` n'a pas d'entrée `denoise` : le workflow
img2img utilise `BasicScheduler`, qui produit les sigmas à partir du taux de
débruitage, et `VAEEncode` pour repartir des pixels de l'image précédente.
Sur Automatic1111, l'équivalent passe par `init_images` et `denoise_strength`.

Les poses sont décrites en langage naturel par `animationPose()` : chaque
mouvement a son cycle de quatre phases (contact / passage pour la marche,
armé / frappe / suivi / récupération pour l'attaque, etc.).

#### Pourquoi les pixels restent nets

La résolution de génération est choisie comme un **multiple entier** de la
taille du sprite : une cible de 48 px est générée à 528 px (×11) et non
512 px (×10,67). Un rapport non entier produit des pixels de tailles
inégales et des contours flous après réduction ; un rapport entier donne
des aplats de couleur uniformes.

La réduction utilise la **couleur dominante exacte** de chaque bloc : les
pixels sont comparés par couleur RGB précise et non par plage de 16
niveaux, ce qui évite de fusionner deux teintes voisines d'un même sprite.

La conversion retire le fond uni **avant** la réduction, conserve le canal
alpha existant et recadre les sprites fixes sans étirer leur silhouette.
La palette ne modifie pas les couleurs déjà dans le budget choisi. Les
contours finaux ont un alpha binaire pour rester nets dans l'éditeur.

Le détourage corrige aussi les pixels de bord mélangés au fond : leur couleur
et leur couverture sont estimées depuis les pixels voisins, avant réduction.
Cela évite les petits résidus blancs autour des ailes et des pattes. Le traitement
reste limité au bord extérieur et conserve les reflets blancs/gris à l'intérieur,
les contours diagonaux fins et les images possédant déjà un canal alpha.

Les options API sont fondées sur la [documentation officielle OpenAI](https://developers.openai.com/api/docs/guides/image-generation)
et la [référence Images](https://developers.openai.com/api/reference/resources/images/methods/generate),
consultées le 5 octobre 2026. L'accès réel à un modèle dépend du compte API.

Les options API sont fondées sur la [documentation officielle OpenAI](https://developers.openai.com/api/docs/guides/image-generation)
et la [référence Images](https://developers.openai.com/api/reference/resources/images/methods/generate),
consultées le 5 octobre 2026. L'accès réel à un modèle dépend du compte API.

#### Brancher un serveur IA local (ComfyUI / Automatic1111)

Le profil par défaut est **FLUX.2 Klein + LoRA de spritesheets** dans ComfyUI.
Il utilise le VAE FLUX.2, Euler et **4 étapes**, puis crée des pixels nets et un
fond transparent dans PixelForge. Le workflow natif FLUX.2 charge chaque fichier
séparément ; le mode manuel SD/SDXL garde son workflow de checkpoint.

**Démarrer ComfyUI** (l'app a besoin de `--listen` et du CORS) :

```powershell
npm run comfy
```

Le script détecte automatiquement votre installation ComfyUI (variable
`COMFY_HOME`, `~/ComfyUI`, ou celle de Comfy Desktop) et lance son venv.
Pour un dossier précis :

```powershell
COMFY_HOME=D:/ComfyUI npm run comfy
```

**Vérifier l'installation** (ne télécharge rien, signale ce qui manque) :

```powershell
npm run check:pixel-model
```

Le script détecte votre ComfyUI, vérifie chaque fichier du profil, le custom
node ComfyUI-GGUF, et signale les incompatibilités connues — notamment un
encodeur Qwen 3 4B installé à la place du Qwen 3 8B attendu par le modèle 9B.

**Profil détecté sur cette machine** (RTX 4070 12 Go) :

| Fichier | Rôle |
|---------|------|
| `flux-2-klein-9b-Q4_K_S.gguf` | modèle GGUF 9B quantifié (via `UnetLoaderGGUF`) |
| `qwen_3_8b_fp8mixed.safetensors` | encodeur de texte Qwen 3 8B |
| `flux2-vae.safetensors` | VAE FLUX.2 |
| `klein-spritesheet-lora.safetensors` | LoRA de spritesheets |

> **L'encodeur doit correspondre au modèle.** Le variant 9B attend une dimension
> de texte de 4096 (Qwen 3 8B). Qwen 3 4B (2560) provoque l'erreur
> `mat1 and mat2 shapes cannot be multiplied`. Les modèles GGUF se chargent avec
> le nœud `UnetLoaderGGUF` du custom node [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF),
> pas avec `UNETLoader`.

Dans l'app, choisissez **Serveur IA local → ComfyUI → FLUX.2 Klein — pixel art**.
La connexion vérifie les fichiers du profil et signale précisément ceux qui
manquent. Le prompt négatif et le CFG des modèles SD ne s'appliquent pas au
profil Klein distillé. Les anciennes préférences procédurales, la configuration
SD 1.5 fournie et les anciens noms de fichiers du profil Klein sont migrées
automatiquement ; les serveurs personnalisés restent configurables.

Pour reproduire les rendus réels (ComfyUI doit être libre) :

```powershell
npm run validate:pixel-model
# Facultatif : comparer au précédent SD 1.5 + PixelArtRedmond installé
npm run validate:pixel-model -- --baseline
```

Les PNG sources, sprites 64/128 px, workflows, graines et durées sont enregistrés
dans `public/generation-samples`. Cette validation utilise les fonctions de
workflow et de conversion de l'app, avec le serveur réel.

Le profil a été testé avec trois descriptions françaises : dragon bleu avec deux
ailes, chevalier doré avec épée, tuile de gazon. Les exemples sont ouvrables
depuis **« Exemples générés avec FLUX.2 Klein »** dans l'onglet Génération.
Les réglages par défaut sont **128 px, 48 couleurs, Pixels nets**. Le modèle
produit un fond blanc ; le canal alpha final est créé par le détourage de
PixelForge.

1. Lancez votre serveur avec l'API et le CORS activés :

   | Serveur | Commande de lancement |
   |---|---|
   | Automatic1111 / Forge | `./webui.sh --api --cors-allow-origins=*`<br />(Windows : `webui-user.bat` avec `set COMMANDLINE_ARGS=--api --cors-allow-origins=*`) |
   | ComfyUI | `npm run comfy` (équivalent à `python main.py --listen --enable-cors-header`) |

   > `--listen` est indispensable : sans lui, ComfyUI n'écoute que sur
   > `127.0.0.1` et le navigateur ne peut pas le joindre depuis l'app.

2. Dans PixelForge : moteur **« Serveur IA local »**, choisissez le type de
   serveur, vérifiez l'URL (A1111 : `http://127.0.0.1:7860`,
   ComfyUI : `http://127.0.0.1:8188`), puis cliquez sur
   **« Tester la connexion »** : les modèles, samplers et planificateurs
   disponibles sont récupérés automatiquement.
3. Réglez les paramètres (étapes, CFG, sampler, résolution, prompt négatif)
   et générez. Pour un rendu pixel art net, chargez un modèle spécialisé
   (profil FLUX.2 ci-dessus, ou un checkpoint SDXL + LoRA compatible) :
   - **ComfyUI** : les LoRA du dossier `models/loras` sont détectées et
     appliquées via un nœud `LoraLoader` (sélecteur + poids) ;
   - **Automatic1111 / Forge** : le champ **LoRA** ajoute automatiquement
     `<lora:nom:poids>` au prompt.

Pendant la génération, la **barre de progression** affiche l'avancement
réel du serveur (via `/sdapi/v1/progress` sur A1111, temps écoulé sur
ComfyUI) ; chaque demande peut être annulée individuellement.

Seul le prompt enrichi part vers le serveur ; les images reviennent en local
et sont pixelisées par l'application selon les réglages de fond et de palette.

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
│   ├── prompt.ts         # Analyse du prompt + cadrage (vue) et styles
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
├── start-comfy.mjs      # Démarre ComfyUI (API + CORS) pour la génération
├── check-pixel-model.mjs# Vérifie que le profil de modèles est complet
└── mock-sd-server.mjs   # Serveur de test A1111 + ComfyUI (sans GPU)
```

Les opérations de dessin **et de génération** sont testées par Vitest
(144 tests) : remplissage, formes, composition, historique,
sauvegarde/restauration du projet, analyse de prompt, cadrage et styles,
conversion image → pixel art, résolution de génération à multiple entier,
payloads et workflows des serveurs IA locaux (dont le nœud LoRA), file
d'attente (ordre, progression, annulation, erreurs).

## Pistes d'amélioration

- File d'attente : réordonnancement par glisser-déposer.
- Connexion WebSocket à ComfyUI pour un pourcentage de progression exact.
- Outil sélection : déplacer/copier-coller la zone sélectionnée.
- Transformation : retournement, rotation, décalage de calque.
- Mode symétrie (miroir horizontal/vertical).
- Palette d'animation avec tag/boucles (A/B tags comme Aseprite).
- Export de tilemaps animées et support du format `LDtk`.
