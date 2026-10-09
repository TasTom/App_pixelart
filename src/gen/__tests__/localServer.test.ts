import { describe, expect, it } from 'vitest';
import {
  buildA1111Payload,
  buildComfyWorkflow,
  buildFlux2Img2ImgWorkflow,
  defaultServerConfig,
  fluxPixelArtConfig,
  generationResolution,
  localConfigError,
  comfyChoices,
  parseComfyError,
  loraToken,
  parseA1111Images,
  parseComfyImages,
} from '../localServer';

const cfgA1111 = {
  ...defaultServerConfig('a1111'),
  checkpoint: 'pixelArt_v1.safetensors',
};
const cfgComfy = {
  ...defaultServerConfig('comfyui'),
  checkpoint: 'pixelArt_v1.safetensors',
  steps: 30,
  cfgScale: 6.5,
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
  resolution: 1024,
};

describe('generationResolution', () => {
  it('choisit un multiple entier de la taille cible', () => {
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      const resolution = generationResolution(size);
      expect(resolution % size).toBe(0);
    }
  });

  it('se rapproche de la résolution native du modèle', () => {
    expect(generationResolution(32)).toBe(512);
    expect(generationResolution(64)).toBe(512);
    expect(generationResolution(128)).toBe(512);
    // 48 ne peut pas atteindre 512 avec un multiple entier : 528 (×11) est le plus proche.
    expect(generationResolution(48)).toBe(528);
    expect(generationResolution(24)).toBe(504);
  });

  it('respecte les contraintes des modèles de diffusion', () => {
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      expect(generationResolution(size) % 8).toBe(0);
    }
  });

  it('accepte une résolution native différente (SDXL)', () => {
    expect(generationResolution(64, 1024)).toBe(1024);
    expect(generationResolution(128, 1024)).toBe(1024);
  });
});

describe('loraToken', () => {
  it('ajoute la balise LoRA avec le poids', () => {    expect(loraToken('pixel-art-xl', 0.8)).toBe(' <lora:pixel-art-xl:0.8>');
  });

  it('retire l’extension du fichier', () => {
    expect(loraToken('pixel_art.safetensors', 1)).toBe(' <lora:pixel_art:1>');
  });

  it('ignore un nom vide et borne le poids', () => {
    expect(loraToken('   ', 0.8)).toBe('');
    expect(loraToken('x', 5)).toBe(' <lora:x:2>');
  });
});

describe('buildA1111Payload', () => {
  it('construit la requête txt2img', () => {
    const payload = buildA1111Payload(cfgA1111, { prompt: 'dragon', seed: 42 });
    expect(payload.prompt).toBe('dragon');
    expect(payload.seed).toBe(42);
    expect(payload.width).toBe(512);
    expect(payload.height).toBe(512);
    expect(payload.steps).toBe(24);
    expect(payload.cfg_scale).toBe(7);
    expect(payload.batch_size).toBe(1);
    expect(payload.negative_prompt.length).toBeGreaterThan(20);
  });

  it('applique la LoRA au prompt', () => {
    const payload = buildA1111Payload(
      { ...cfgA1111, lora: 'pixel-art-xl', loraWeight: 0.7 },
      { prompt: 'chevalier', seed: 1 },
    );
    expect(payload.prompt).toContain('<lora:pixel-art-xl:0.7>');
  });

  it('respecte la résolution et les étapes', () => {
    const payload = buildA1111Payload(
      { ...cfgA1111, resolution: 1024, steps: 40 },
      { prompt: 'x', seed: 0 },
    );
    expect(payload.width).toBe(1024);
    expect(payload.steps).toBe(40);
  });
});

describe('parseA1111Images', () => {
  it('extrait les images base64', () => {
    const images = parseA1111Images({ images: ['abc', 'def'] });
    expect(images).toEqual(['abc', 'def']);
  });

  it('tolère les réponses invalides', () => {
    expect(parseA1111Images(null)).toEqual([]);
    expect(parseA1111Images({})).toEqual([]);
    expect(parseA1111Images({ images: [1, 2] })).toEqual([]);
  });
});

describe('buildComfyWorkflow', () => {
  it('construit un workflow txt2img complet', () => {
    const wf = buildComfyWorkflow(cfgComfy, { prompt: 'dragon bleu', seed: 7 });
    expect(wf['1'].class_type).toBe('CheckpointLoaderSimple');
    expect(wf['1'].inputs.ckpt_name).toBe('pixelArt_v1.safetensors');
    expect(wf['2'].class_type).toBe('EmptyLatentImage');
    expect(wf['2'].inputs.width).toBe(1024);
    expect(wf['3'].inputs.text).toBe('dragon bleu');
    expect(wf['4'].inputs.text).toBe(cfgComfy.negativePrompt);
    const sampler = wf['5'];
    expect(sampler.class_type).toBe('KSampler');
    expect(sampler.inputs.seed).toBe(7);
    expect(sampler.inputs.steps).toBe(30);
    expect(sampler.inputs.cfg).toBe(6.5);
    expect(sampler.inputs.sampler_name).toBe('dpmpp_2m');
    expect(sampler.inputs.scheduler).toBe('karras');
    expect(wf['6'].class_type).toBe('VAEDecode');
    expect(wf['7'].class_type).toBe('SaveImage');
  });

  it('relie les nœuds entre eux', () => {
    const wf = buildComfyWorkflow(cfgComfy, { prompt: 'x', seed: 0 });
    expect(wf['5'].inputs.model).toEqual(['1', 0]);
    expect(wf['5'].inputs.positive).toEqual(['3', 0]);
    expect(wf['5'].inputs.negative).toEqual(['4', 0]);
    expect(wf['5'].inputs.latent_image).toEqual(['2', 0]);
    expect(wf['6'].inputs.samples).toEqual(['5', 0]);
    expect(wf['7'].inputs.images).toEqual(['6', 0]);
  });

  it('insère un nœud LoraLoader quand une LoRA est choisie', () => {
    const wf = buildComfyWorkflow(
      { ...cfgComfy, lora: 'pixel-art-xl.safetensors', loraWeight: 0.75 },
      { prompt: 'chevalier', seed: 3 },
    );
    const lora = wf['0'];
    expect(lora.class_type).toBe('LoraLoader');
    expect(lora.inputs.lora_name).toBe('pixel-art-xl.safetensors');
    expect(lora.inputs.strength_model).toBe(0.75);
    expect(lora.inputs.strength_clip).toBe(0.75);
    expect(lora.inputs.model).toEqual(['1', 0]);
    expect(lora.inputs.clip).toEqual(['1', 1]);
    // Le sampler et les textes passent par la LoRA.
    expect(wf['5'].inputs.model).toEqual(['0', 0]);
    expect(wf['3'].inputs.clip).toEqual(['0', 1]);
    expect(wf['4'].inputs.clip).toEqual(['0', 1]);
  });

  it('n’ajoute aucun nœud LoRA sans sélection', () => {
    const wf = buildComfyWorkflow({ ...cfgComfy, lora: '  ' }, { prompt: 'x', seed: 0 });
    expect(wf['0']).toBeUndefined();
    expect(wf['5'].inputs.model).toEqual(['1', 0]);
    expect(wf['3'].inputs.clip).toEqual(['1', 1]);
  });
});

describe('parseComfyImages', () => {
  it('extrait les références d’images de l’historique', () => {
    const history = {
      'prompt-abc': {
        outputs: {
          '7': {
            images: [
              {
                filename: 'pixelforge_00001_.png',
                subfolder: 'sub',
                type: 'output',
              },
            ],
          },
        },
      },
    };
    expect(parseComfyImages(history, 'prompt-abc')).toEqual([
      { filename: 'pixelforge_00001_.png', subfolder: 'sub', type: 'output' },
    ]);
  });

  it('retourne un tableau vide si la tâche n’est pas terminée', () => {
    expect(parseComfyImages({}, 'prompt-abc')).toEqual([]);
    expect(parseComfyImages({ 'prompt-abc': {} }, 'prompt-abc')).toEqual([]);
    expect(parseComfyImages(null, 'prompt-abc')).toEqual([]);
  });

  it('accepte des sous-dossiers et types manquants', () => {
    const history = {
      p: { outputs: { '7': { images: [{ filename: 'a.png' }] } } },
    };
    expect(parseComfyImages(history, 'p')).toEqual([
      { filename: 'a.png', subfolder: '', type: 'output' },
    ]);
  });
});

describe('profil natif FLUX.2 Klein', () => {
  it('utilise les loaders séparés et les latents FLUX.2, pas le workflow SD', () => {
    const cfg = fluxPixelArtConfig();
    const wf = buildComfyWorkflow(cfg, { prompt: 'dragon bleu avec deux ailes', seed: 42 });
    expect(wf['1'].inputs.unet_name).toBe(cfg.diffusionModel);
    expect(wf['2'].inputs).toEqual({ clip_name: cfg.textEncoder, type: 'flux2', device: 'default' });
    expect(wf['3'].inputs.vae_name).toBe(cfg.vae);
    expect(wf['5'].class_type).toBe('EmptyFlux2LatentImage');
    expect(wf['9'].class_type).toBe('Flux2Scheduler');
    expect(wf['9'].inputs.steps).toBe(4);
    expect(wf['7'].inputs.noise_seed).toBe(42);
    expect(wf['6'].class_type).toBe('BasicGuider');
    expect(Object.values(wf).some((node) => node.class_type === 'CheckpointLoaderSimple')).toBe(false);
    expect(Object.values(wf).some((node) => node.inputs.text === cfg.negativePrompt)).toBe(false);
  });

  it('applique la LoRA au modèle, garde Qwen intact et décode avec le bon VAE', () => {
    const wf = buildComfyWorkflow(fluxPixelArtConfig(), { prompt: 'dragon bleu', seed: 1 });
    expect(wf['0'].class_type).toBe('LoraLoaderModelOnly');
    expect(wf['0'].inputs.strength_model).toBe(1);
    expect(wf['6'].inputs.model).toEqual(['0', 0]);
    expect(wf['4'].inputs.clip).toEqual(['2', 0]);
    expect(wf['4'].inputs.text).toBe('dragon bleu');
    expect(wf['10'].inputs.sigmas).toEqual(['9', 0]);
    expect(wf['10'].inputs.latent_image).toEqual(['5', 0]);
    expect(wf['11'].inputs.vae).toEqual(['3', 0]);
  });

  it('charge un modèle GGUF via UnetLoaderGGUF', () => {
    const cfg = fluxPixelArtConfig();
    expect(cfg.diffusionModel).toMatch(/\.gguf$/i);
    const wf = buildComfyWorkflow(cfg, { prompt: 'dragon bleu', seed: 1 });
    expect(wf['1'].class_type).toBe('UnetLoaderGGUF');
    expect(wf['1'].inputs).toEqual({ unet_name: cfg.diffusionModel });
  });

  it('garde UNETLoader pour un modèle safetensors', () => {
    const cfg = { ...fluxPixelArtConfig(), diffusionModel: 'flux-2-klein-4b-fp8.safetensors' };
    const wf = buildComfyWorkflow(cfg, { prompt: 'dragon bleu', seed: 1 });
    expect(wf['1'].class_type).toBe('UNETLoader');
    expect(wf['1'].inputs.weight_dtype).toBe('default');
  });
});

describe('workflow img2img FLUX.2', () => {
  it('encode les latents depuis l’image et applique un débruitage partiel', () => {
    const wf = buildFlux2Img2ImgWorkflow(fluxPixelArtConfig(), {
      prompt: 'dragon bleu',
      seed: 7,
      initImage: 'anim_prev.png',
      denoise: 0.62,
    });
    expect(wf['5'].class_type).toBe('LoadImage');
    expect(wf['5'].inputs.image).toBe('anim_prev.png');
    expect(wf['6'].class_type).toBe('VAEEncode');
    expect(wf['6'].inputs.pixels).toEqual(['5', 0]);
    // Flux2Scheduler n'a pas de denoise : BasicScheduler le fournit.
    expect(wf['7'].class_type).toBe('BasicScheduler');
    expect(wf['7'].inputs.denoise).toBe(0.62);
    expect(wf['11'].inputs.latent_image).toEqual(['6', 0]);
    expect(wf['11'].inputs.sigmas).toEqual(['7', 0]);
    expect(wf['7'].inputs.model).toEqual(['0', 0]);
  });

  it('borne le débruitage entre 0,05 et 1', () => {
    const cfg = fluxPixelArtConfig();
    expect(buildFlux2Img2ImgWorkflow(cfg, { prompt: 'x', seed: 0, initImage: 'a.png', denoise: 0 })['7'].inputs.denoise).toBe(0.05);
    expect(buildFlux2Img2ImgWorkflow(cfg, { prompt: 'x', seed: 0, initImage: 'a.png', denoise: 5 })['7'].inputs.denoise).toBe(1);
  });

  it('fonctionne sans LoRA', () => {
    const wf = buildFlux2Img2ImgWorkflow({ ...fluxPixelArtConfig(), lora: '' }, {
      prompt: 'x', seed: 0, initImage: 'a.png', denoise: 0.6,
    });
    expect(wf['0']).toBeUndefined();
    expect(wf['7'].inputs.model).toEqual(['1', 0]);
  });

  it('requiert les trois fichiers natifs et autorise un modèle sans LoRA', () => {
    const cfg = fluxPixelArtConfig();
    expect(localConfigError(cfg)).toBeNull();
    expect(localConfigError({ ...cfg, textEncoder: '' })).toContain('Qwen');
    const wf = buildComfyWorkflow({ ...cfg, lora: '' }, { prompt: 'x', seed: 0 });
    expect(wf['0']).toBeUndefined();
    expect(wf['6'].inputs.model).toEqual(['1', 0]);
  });
});

describe('réponses ComfyUI actuelles', () => {
  it('lit les enums historiques et le schéma COMBO actuel', () => {
    expect(comfyChoices({ N: { input: { required: { f: [['euler', 'heun']] } } } }, 'N', 'f')).toEqual(['euler', 'heun']);
    expect(comfyChoices({ N: { input: { required: { f: ['COMBO', { options: ['euler', 'heun'] }] } } } }, 'N', 'f')).toEqual(['euler', 'heun']);
    expect(comfyChoices({}, 'N', 'f')).toEqual([]);
  });

  it('remonte une panne du modèle sans attendre le timeout', () => {
    expect(parseComfyError({ p: { status: { status_str: 'error', messages: [['execution_error', { node_type: 'CLIPLoader', exception_message: 'out of memory' }]] } } }, 'p')).toContain('CLIPLoader');
    expect(parseComfyError({ p: { status: { status_str: 'error', messages: [['execution_interrupted', {}]] } } }, 'p')).toContain('interrompue');
    expect(parseComfyError({}, 'p')).toBeNull();
    expect(parseComfyError({ p: { status: { status_str: 'success' } } }, 'p')).toBeNull();
  });
});
