#!/usr/bin/env node
/**
 * Démarre ComfyUI avec les options requises par PixelForge :
 *   --listen             écoute sur toutes les interfaces (le navigateur
 *                        doit pouvoir joindre le serveur)
 *   --enable-cors-header autorise les requêtes cross-origin depuis l'app
 *   --port               port du serveur (8188 par défaut)
 *
 * Usage :
 *   npm run comfy                      # installation détectée automatiquement
 *   npm run comfy -- --port 8188
 *   COMFY_HOME=D:/ComfyUI npm run comfy
 *
 * Le script cherche une installation ComfyUI dans cet ordre :
 *   1. COMFY_HOME (variable d'environnement)
 *   2. ./ComfyUI, ../ComfyUI (relatif au projet)
 *   3. ~/ComfyUI
 *   4. le ComfyUI embarqué de Comfy Desktop
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : '8188';

/** Chemins candidats pour une installation ComfyUI. */
function candidates() {
  const list = [];
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

/** Retourne le python du venv, ou null. */
function findPython(root) {
  const venvs = ['.venv', 'venv'];
  for (const v of venvs) {
    const py = join(root, v, 'Scripts', 'python.exe');
    if (existsSync(py)) return py;
  }
  // Python système en dernier recours.
  return 'python';
}

const root = candidates().find((dir) => existsSync(join(dir, 'main.py')));
if (!root) {
  console.error(
    'ComfyUI introuvable. Indiquez son dossier avec COMFY_HOME :\n' +
      '  COMFY_HOME=D:/ComfyUI npm run comfy\n' +
      'Chemins testés :\n' +
      candidates().map((c) => `  - ${c}`).join('\n'),
  );
  process.exit(1);
}

const python = findPython(root);
const mainPy = join(root, 'main.py');
const comfyArgs = [
  mainPy,
  '--listen',
  '--port',
  port,
  '--enable-cors-header',
  // Les arguments supplémentaires de l'utilisateur sont transmis tels quels.
  ...args.filter((a, i) => !(a === '--port' || args[i - 1] === '--port')),
];

console.log(`ComfyUI   : ${root}`);
console.log(`Python    : ${python}`);
console.log(`Écoute    : http://127.0.0.1:${port}`);
console.log(`CORS      : activé (requis par PixelForge)`);
console.log('');

const child = spawn(python, comfyArgs, { cwd: root, stdio: 'inherit' });

child.on('error', (err) => {
  console.error(`Impossible de lancer ComfyUI : ${err.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
    process.exit(0);
  });
}
