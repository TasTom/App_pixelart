#!/usr/bin/env node
/**
 * Vérifie que l'installation ComfyUI correspond au profil PixelForge.
 *
 * Le script ne télécharge rien : il liste les fichiers attendus, indique
 * ceux qui sont présents ou manquants, et signale les incompatibilités
 * connues (encodeur qui ne correspond pas au modèle, custom node absent).
 *
 * Usage :
 *   npm run check:pixel-model              # installation détectée automatiquement
 *   npm run check:pixel-model -- D:/ComfyUI
 *   COMFY_HOME=D:/ComfyUI npm run check:pixel-model
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Profil FLUX.2 Klein attendu par l'application. */
const PROFILE = [
  {
    file: 'unet/flux-2-klein-9b-Q4_K_S.gguf',
    label: 'Modèle FLUX.2 Klein 9B (GGUF Q4_K_S)',
    source: 'https://huggingface.co/unsloth/FLUX.2-klein-9B-GGUF',
    required: true,
  },
  {
    file: 'text_encoders/qwen_3_8b_fp8mixed.safetensors',
    label: 'Encodeur de texte Qwen 3 8B FP8',
    source: 'https://huggingface.co/Comfy-Org/flux2-klein-9B (split_files/text_encoders)',
    required: true,
    // L'encodeur doit correspondre au modèle : le 9B attend une dimension 4096.
    warning:
      'Le variant 9B exige Qwen 3 8B. Qwen 3 4B provoque ' +
      '« mat1 and mat2 shapes cannot be multiplied ».',
  },
  {
    file: 'vae/flux2-vae.safetensors',
    label: 'VAE FLUX.2',
    source: 'https://huggingface.co/Comfy-Org/flux2-klein-9B (split_files/vae)',
    required: true,
  },
  {
    file: 'loras/klein-spritesheet-lora.safetensors',
    label: 'LoRA de spritesheets Klein',
    source: 'https://huggingface.co/fal/flux-2-klein-4b-spritesheet-lora',
    required: false,
    note: 'Facultative : améliore la cohérence des planches de sprites.',
  },
];

/** Custom nodes utiles au profil. */
const CUSTOM_NODES = [
  {
    dir: 'ComfyUI-GGUF',
    label: 'ComfyUI-GGUF',
    why: 'Requis pour charger un modèle .gguf (nœud UnetLoaderGGUF).',
    required: true,
  },
];

function candidates() {
  const list = [];
  if (process.argv[2]) list.push(process.argv[2]);
  if (process.env.COMFY_HOME) list.push(process.env.COMFY_HOME);
  list.push(resolve(process.cwd(), 'ComfyUI'));
  list.push(resolve(process.cwd(), '..', 'ComfyUI'));
  list.push(join(homedir(), 'ComfyUI'));
  list.push(
    join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'Comfy-Desktop',
      'ComfyUI-Installs',
      'ComfyUI',
      'ComfyUI',
    ),
  );
  return list;
}

const root = candidates().find((dir) => existsSync(join(dir, 'main.py')));
if (!root) {
  console.error(
    'ComfyUI introuvable. Indiquez son dossier :\n' +
      '  npm run check:pixel-model -- D:/ComfyUI\n' +
      'Chemins testés :\n' +
      candidates().map((c) => `  - ${c}`).join('\n'),
  );
  process.exit(1);
}

console.log(`ComfyUI : ${root}\n`);

let problems = 0;
const modelsDir = join(root, 'models');

for (const item of PROFILE) {
  const path = join(modelsDir, item.file);
  if (existsSync(path)) {
    const size = statSync(path).size;
    const gb = (size / 1024 ** 3).toFixed(2);
    console.log(`  OK      ${item.label}`);
    console.log(`          ${item.file} (${gb} Go)`);
  } else {
    const mark = item.required ? 'MANQUE' : 'absent';
    if (item.required) problems += 1;
    console.log(`  ${mark.padEnd(7)} ${item.label}`);
    console.log(`          ${item.file}`);
    console.log(`          ${item.source}`);
  }
  if (item.warning) console.log(`          ! ${item.warning}`);
  if (item.note) console.log(`          i ${item.note}`);
}

console.log('');
for (const node of CUSTOM_NODES) {
  const path = join(root, 'custom_nodes', node.dir);
  if (existsSync(path)) {
    console.log(`  OK      ${node.label}`);
  } else {
    if (node.required) problems += 1;
    console.log(`  MANQUE  ${node.label}`);
    console.log(`          ${node.why}`);
    console.log(`          cd custom_nodes && git clone https://github.com/city96/ComfyUI-GGUF`);
  }
}

// Détecte les encodeurs incompatibles installés à côté du bon.
const encoders = join(modelsDir, 'text_encoders');
if (existsSync(encoders)) {
  const { readdirSync } = await import('node:fs');
  const installed = readdirSync(encoders).filter((f) => f.endsWith('.safetensors'));
  const has8b = installed.some((f) => /qwen_3_8b/i.test(f));
  const has4b = installed.some((f) => /qwen_3_4b/i.test(f));
  if (has4b && !has8b) {
    problems += 1;
    console.log('');
    console.log('  ! Seul un encodeur Qwen 3 4B est installé.');
    console.log('    Le modèle 9B nécessite Qwen 3 8B — la génération échouera.');
  }
}

console.log('');
if (problems === 0) {
  console.log('Profil complet : ComfyUI est prêt pour PixelForge.');
  console.log('Démarrez-le avec  npm run comfy');
} else {
  console.log(`${problems} élément(s) manquant(s). Installez-les puis relancez ce contrôle.`);
  process.exit(1);
}
