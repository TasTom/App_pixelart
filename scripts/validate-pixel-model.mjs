import { createServer } from 'vite';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Real GPU validation, never a mock. Uses the application's workflow and pixel converter.
const baseline = process.argv.includes('--baseline');
const comfyDir = process.env.COMFYUI_DIR || 'D:/ComfyUI';
const python = resolve(comfyDir, 'venv/Scripts/python.exe');
const url = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const outDir = resolve('public/generation-samples');
await mkdir(outDir, { recursive: true });
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { buildComfyWorkflow, fluxPixelArtConfig, defaultServerConfig, parseComfyImages, parseComfyError, testLocalServer } = await vite.ssrLoadModule('/src/gen/localServer.ts');
  const { buildAiPrompt } = await vite.ssrLoadModule('/src/gen/prompt.ts');
  const { imageToPixelBuffer } = await vite.ssrLoadModule('/src/gen/pixelate.ts');
  const cfg = baseline ? {
    ...defaultServerConfig('comfyui'), checkpoint: 'v1-5-pruned-emaonly.safetensors',
    lora: 'PixelArtRedmond15V-PixelArt-PIXARFK.safetensors', triggerWords: 'pixel art, PixArFK',
  } : fluxPixelArtConfig();
  cfg.baseUrl = url;
  const status = await testLocalServer(cfg);
  if (!status.ok) throw new Error(status.message);
  const queue = await (await fetch(`${url}/queue`)).json();
  if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error('ComfyUI est occupé. Relancez la validation quand la file est vide.');
  const cases = [
    { id: 'dragon', prompt: 'un petit dragon bleu avec deux ailes déployées, des cornes blanches, une longue queue et un ventre jaune, vue de trois quarts' },
    { id: 'knight', prompt: 'un chevalier en armure dorée, tenant une épée bleue dans une main et un bouclier rouge dans l’autre, casque fermé, personnage entier debout, vue de face' },
    { id: 'potion', prompt: 'une potion magique violette dans une fiole de verre ronde avec un bouchon en liège et une étoile dorée sur l’étiquette, vue de face' },
  ];
  const report = { model: baseline ? 'SD 1.5 + PixelArtRedmond' : 'FLUX.2 Klein 9B GGUF + LoRA spritesheet', config: cfg, cases: [] };
  for (const sample of baseline ? cases.slice(0, 1) : cases) {
    const started = Date.now();
    const id = baseline ? `${sample.id}-sd15` : sample.id;
    const prompt = buildAiPrompt(sample.prompt, 'rpg', 'none', 0, 1, { size: 128, maxColors: 48, assetKind: 'sprite', transparentBackground: true, provider: baseline ? 'server' : 'flux2' });
    const workflow = buildComfyWorkflow(cfg, { prompt, seed: 42 });
    const submit = await fetch(`${url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'pixelforge-validation' }) });
    const submitted = await submit.json();
    if (!submit.ok || !submitted.prompt_id) throw new Error(JSON.stringify(submitted));
    const promptId = submitted.prompt_id;
    console.log(`${id} : tâche ${promptId}`);
    await writeFile(resolve(outDir, `${id}-workflow.json`), JSON.stringify({ promptId, prompt: sample.prompt, seed: 42, workflow }, null, 2));
    let ref;
    let lastLog = 0;
    while (Date.now() - started < 1_200_000) {
      await new Promise((done) => setTimeout(done, 1500));
      const history = await (await fetch(`${url}/history/${promptId}`)).json();
      const error = parseComfyError(history, promptId);
      if (error) throw new Error(error);
      ref = parseComfyImages(history, promptId)[0];
      if (ref) break;
      if (Date.now() - lastLog > 30_000) {
        console.log(`${id} : ${Math.round((Date.now() - started) / 1000)} s, calcul en cours`);
        lastLog = Date.now();
      }
    }
    if (!ref) throw new Error(`Délai dépassé : ${promptId}`);
    const image = await fetch(`${url}/view?${new URLSearchParams(ref)}`);
    if (!image.ok) throw new Error('Image ComfyUI introuvable.');
    const sourceFile = resolve(outDir, `${id}-source.png`);
    await writeFile(sourceFile, new Uint8Array(await image.arrayBuffer()));
    const decoded = spawnSync(python, ['-c', "from PIL import Image; import sys,struct; i=Image.open(sys.argv[1]).convert('RGBA'); sys.stdout.buffer.write(struct.pack('<II',*i.size)+i.tobytes())", sourceFile], { maxBuffer: 16 * 1024 ** 2 });
    if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
    const raw = { width: decoded.stdout.readUInt32LE(0), height: decoded.stdout.readUInt32LE(4), data: new Uint8ClampedArray(decoded.stdout.subarray(8)) };
    const sizes = [];
    for (const size of [64, 128]) {
      const buffer = imageToPixelBuffer(raw, { size, maxColors: size === 64 ? 32 : 48, transparentBackground: true, fitSubject: true, sampling: 'dominant' });
      const colors = new Set();
      let opaque = 0;
      for (let i = 0; i < buffer.data.length; i += 4) {
        if (buffer.data[i + 3]) { opaque++; colors.add(`${buffer.data[i]},${buffer.data[i + 1]},${buffer.data[i + 2]}`); }
        if (buffer.data[i + 3] !== 0 && buffer.data[i + 3] !== 255) throw new Error('Alpha final non binaire.');
      }
      if (!opaque) throw new Error('Sprite vide après conversion.');
      const temp = resolve(outDir, `${id}-${size}.rgba`);
      const png = resolve(outDir, `${id}-${size}.png`);
      await writeFile(temp, buffer.data);
      const encoded = spawnSync(python, ['-c', "from PIL import Image; import sys; n=int(sys.argv[1]); i=Image.frombytes('RGBA',(n,n),open(sys.argv[2],'rb').read()); i.save(sys.argv[3]); i.resize((512,512),Image.Resampling.NEAREST).save(sys.argv[4])", String(size), temp, png, resolve(outDir, `${id}-${size}-preview.png`)]);
      if (encoded.status !== 0) throw new Error(encoded.stderr.toString());
      await unlink(temp);
      sizes.push({ size, colors: colors.size, opaquePixels: opaque });
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    report.cases.push({ ...sample, id, promptId, seed: 42, seconds, sizes });
    await writeFile(resolve(outDir, baseline ? 'validation-sd15.json' : 'validation.json'), JSON.stringify(report, null, 2));
    console.log(`${id} terminé en ${seconds} s : ${JSON.stringify(sizes)}`);
  }
  if (!baseline) {
    const rendered = spawnSync(python, [resolve('scripts/render-pixel-validation.py'), outDir]);
    if (rendered.status !== 0) throw new Error(rendered.stderr.toString());
  }
} finally {
  await vite.close();
}
