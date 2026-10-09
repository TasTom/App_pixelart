import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const python = process.env.COMFYUI_PYTHON || 'D:/ComfyUI/venv/Scripts/python.exe';
const root = resolve('artifacts/cutout-validation');
await mkdir(root, { recursive: true });
const suffix = process.argv[2] || 'before';
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', ssr: { noExternal: ['gifenc'] } });
try {
  const { imageToPixelBuffer } = await vite.ssrLoadModule('/src/gen/pixelate.ts');
  const { useEditorStore } = await vite.ssrLoadModule('/src/state/store.ts');
  const { serializeProject, parseProject } = await vite.ssrLoadModule('/src/export/exporters.ts');
  for (const id of ['00007', '00008', '00009']) {
    const decoded = spawnSync(python, ['-c', "from PIL import Image; import sys,struct; i=Image.open(sys.argv[1]).convert('RGBA'); sys.stdout.buffer.write(struct.pack('<II',*i.size)+i.tobytes())", resolve(root, `source-${id}.png`)], { maxBuffer: 16 * 1024 ** 2 });
    if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
    const raw = { width: decoded.stdout.readUInt32LE(0), height: decoded.stdout.readUInt32LE(4), data: new Uint8ClampedArray(decoded.stdout.subarray(8)) };
    const output = imageToPixelBuffer(raw, { size: 128, maxColors: 48, transparentBackground: true, fitSubject: true, sampling: 'dominant' });
    const temp = resolve(root, `${id}-${suffix}.rgba`);
    await writeFile(temp, output.data);
    const encoded = spawnSync(python, ['-c', `from PIL import Image,ImageDraw
import sys
i=Image.frombytes('RGBA',(128,128),open(sys.argv[1],'rb').read())
i.save(sys.argv[2])
bg=Image.new('RGBA',(512,512),(42,44,54,255));d=ImageDraw.Draw(bg)
for y in range(0,512,8):
 for x in range(0,512,8):
  if (x//8+y//8)%2:d.rectangle((x,y,x+7,y+7),fill=(49,51,62,255))
bg.alpha_composite(i.resize((512,512),Image.Resampling.NEAREST));bg.convert('RGB').save(sys.argv[3])
`, temp, resolve(root, `${id}-${suffix}.png`), resolve(root, `${id}-${suffix}-preview.png`)]);
    if (encoded.status !== 0) throw new Error(encoded.stderr.toString());
    await unlink(temp);
    if (suffix === 'after') {
      useEditorStore.getState().newDocFromBuffers(id === '00009' ? 'Arbre — détourage corrigé' : 'Dragon — détourage corrigé', [output]);
      const project = serializeProject(useEditorStore.getState().doc);
      const reopened = parseProject(project);
      const restored = reopened.layers.find((layer) => layer.type === 'raster')?.frames[0];
      if (!restored || restored.data.some((value, index) => value !== output.data[index])) throw new Error('Projet corrigé invalide.');
      await writeFile(resolve(root, `${id}-corrected.pixelforge.json`), project);
    }
    console.log(`${id} : ${suffix}`);
  }
} finally { await vite.close(); }
