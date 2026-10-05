#!/usr/bin/env node
/**
 * Serveur de test qui imite les API d'Automatic1111/Forge (/sdapi/v1/*)
 * et de ComfyUI (/prompt, /history, /view) sans GPU ni modèle.
 * Sert à valider la connexion du moteur « Serveur IA local » de PixelForge.
 *
 * Usage : node scripts/mock-sd-server.mjs [port]
 */
import http from 'node:http';
import zlib from 'node:zlib';

const PORT = Number(process.argv[2] ?? 7860);
const CHECKPOINT = 'mockPixelArt_v1.safetensors';

/* -------------------------- PNG (sans dépendance) -------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- Rendu d'un « sprite » ---------------------------- */

function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

function renderSprite(size, seed) {
  const rgba = Buffer.alloc(size * size * 4, 255); // fond blanc uni
  const hue = seed % 360;
  const unit = size / 32;

  const set = (x, y, color) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const i = (yi * size + xi) * 4;
    rgba[i] = color[0];
    rgba[i + 1] = color[1];
    rgba[i + 2] = color[2];
    rgba[i + 3] = 255;
  };
  const disc = (cx, cy, r, color) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) set(x, y, color);
      }
    }
  };
  const rect = (x, y, w, h, color) => {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) set(x + xx, y + yy, color);
    }
  };

  const base = hslToRgb(hue, 0.65, 0.55);
  const dark = hslToRgb(hue, 0.7, 0.35);
  const light = hslToRgb(hue, 0.5, 0.72);
  const skin = hslToRgb(30, 0.5, 0.75);
  const cx = size / 2;

  rect(cx - 5 * unit, size - 8 * unit, 3.5 * unit, 6 * unit, dark);
  rect(cx + 1.5 * unit, size - 8 * unit, 3.5 * unit, 6 * unit, dark);
  rect(cx - 6 * unit, 13 * unit, 12 * unit, 12 * unit, base);
  rect(cx - 6 * unit, 13 * unit, 12 * unit, 2 * unit, light);
  rect(cx - 8.5 * unit, 14 * unit, 2.5 * unit, 9 * unit, base);
  rect(cx + 6 * unit, 14 * unit, 2.5 * unit, 9 * unit, base);
  disc(cx, 9 * unit, 5.5 * unit, skin);
  disc(cx - 2 * unit, 8.5 * unit, 1.2 * unit, [30, 30, 40]);
  disc(cx + 2 * unit, 8.5 * unit, 1.2 * unit, [30, 30, 40]);

  return encodePng(size, size, rgba);
}

/* ------------------------------- Serveur HTTP ------------------------------- */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, code, payload) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** prompt_id → image simulée (ComfyUI). */
const comfyJobs = new Map();

/** Tâche A1111 en cours (pour /sdapi/v1/progress). */
let a1111Job = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ---------- Automatic1111 / Forge ----------
  if (path === '/sdapi/v1/sd-models') {
    return sendJson(res, 200, [
      { title: CHECKPOINT, model_name: CHECKPOINT.replace('.safetensors', '') },
      { title: 'sdxl_base_1.0.safetensors', model_name: 'sdxl_base_1.0' },
    ]);
  }
  if (path === '/sdapi/v1/options') {
    return sendJson(res, 200, { sd_model_checkpoint: CHECKPOINT });
  }
  if (path === '/sdapi/v1/samplers') {
    return sendJson(res, 200, [{ name: 'Euler a' }, { name: 'DPM++ 2M' }]);
  }
  if (path === '/sdapi/v1/progress') {
    const progress = a1111Job
      ? Math.min(1, (Date.now() - a1111Job.startedAt) / a1111Job.duration)
      : 0;
    return sendJson(res, 200, {
      progress,
      state: { job_count: a1111Job ? 1 : 0, sampling_step: 0, sampling_steps: 24 },
    });
  }
  if (path === '/sdapi/v1/txt2img' && req.method === 'POST') {
    const body = await readBody(req);
    const prompt = String(body.prompt ?? '');
    const size = Math.min(1024, Math.max(64, Number(body.width) || 512));
    console.log(
      `[mock:a1111] txt2img « ${prompt.slice(0, 48)} » ${size}x${size} ` +
        `steps=${body.steps} cfg=${body.cfg_scale} seed=${body.seed}`,
    );
    // Simule un temps de calcul pour que la barre de progression soit visible.
    a1111Job = { startedAt: Date.now(), duration: 3000 };
    await sleep(3000);
    a1111Job = null;
    const png = renderSprite(size, hashString(prompt));
    return sendJson(res, 200, {
      images: [png.toString('base64')],
      parameters: body,
      info: '{"mock":true}',
    });
  }

  // ---------- ComfyUI ----------
  if (path === '/system_stats') {
    return sendJson(res, 200, {
      system: { os: 'mock', comfyui_version: 'mock-1.0' },
      devices: [],
    });
  }
  if (path === '/object_info/CheckpointLoaderSimple') {
    return sendJson(res, 200, {
      CheckpointLoaderSimple: {
        input: {
          required: { ckpt_name: [[CHECKPOINT, 'sdxl_base_1.0.safetensors']] },
        },
      },
    });
  }
  if (path === '/object_info/KSampler') {
    return sendJson(res, 200, {
      KSampler: {
        input: {
          required: {
            sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m', 'ddim']],
            scheduler: [['normal', 'karras', 'exponential']],
          },
        },
      },
    });
  }
  if (path === '/object_info/LoraLoader') {
    return sendJson(res, 200, {
      LoraLoader: {
        input: {
          required: {
            lora_name: [
              ['pixel-art-xl.safetensors', 'pixel-art-redux.safetensors'],
            ],
          },
        },
      },
    });
  }
  if (path === '/prompt' && req.method === 'POST') {
    const body = await readBody(req);
    const workflow = body.prompt ?? {};
    const nodes = Object.values(workflow);
    const sampler = nodes.find((n) => n?.class_type === 'KSampler');
    const latent = nodes.find((n) => n?.class_type === 'EmptyLatentImage');
    const positive = nodes.find((n) => n?.class_type === 'CLIPTextEncode');
    const promptId = `mock-${Math.random().toString(36).slice(2, 10)}`;
    const size = Math.min(
      1024,
      Math.max(64, Number(latent?.inputs?.width) || 512),
    );
    comfyJobs.set(promptId, {
      png: renderSprite(size, hashString(String(positive?.inputs?.text ?? ''))),
      readyAt: Date.now() + 1200,
    });
    const lora = nodes.find((n) => n?.class_type === 'LoraLoader');
    console.log(
      `[mock:comfyui] prompt ${promptId} ` +
        `« ${String(positive?.inputs?.text ?? '').slice(0, 40)} » ` +
        `steps=${sampler?.inputs?.steps} cfg=${sampler?.inputs?.cfg} ` +
        `sampler=${sampler?.inputs?.sampler_name} ` +
        `lora=${
          lora
            ? `${lora.inputs.lora_name}@${lora.inputs.strength_model}`
            : 'aucune'
        }`,
    );
    return sendJson(res, 200, { prompt_id: promptId, number: 1 });
  }
  if (path.startsWith('/history/')) {
    const promptId = path.slice('/history/'.length);
    const job = comfyJobs.get(promptId);
    if (!job || Date.now() < job.readyAt) return sendJson(res, 200, {});
    return sendJson(res, 200, {
      [promptId]: {
        outputs: {
          '7': {
            images: [
              {
                filename: `pixelforge_${promptId}.png`,
                subfolder: '',
                type: 'output',
              },
            ],
          },
        },
        status: { completed: true },
      },
    });
  }
  if (path === '/view') {
    const filename = url.searchParams.get('filename') ?? '';
    const promptId = filename.replace('pixelforge_', '').replace('.png', '');
    const job = comfyJobs.get(promptId);
    if (!job) return sendJson(res, 404, { error: 'image introuvable' });
    cors(res);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(job.png);
    return;
  }

  return sendJson(res, 404, { error: 'route inconnue', path });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serveur de test A1111 + ComfyUI sur http://127.0.0.1:${PORT}`);
  console.log('Dans PixelForge : moteur « Serveur IA local », URL ci-dessus.');
});
