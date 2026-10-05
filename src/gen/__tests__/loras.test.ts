import { describe, expect, it } from 'vitest';
import {
  describeLoraTrigger,
  findLoraTrigger,
  withTriggerWords,
} from '../loras';
import { buildA1111Payload, buildComfyWorkflow, defaultServerConfig } from '../localServer';

describe('findLoraTrigger', () => {
  it('détecte la LoRA PixelArtRedmond', () => {
    expect(
      findLoraTrigger('PixelArtRedmond15V-PixelArt-PIXARFK.safetensors'),
    ).toBe('pixel art, PixArFK');
  });

  it('détecte la LoRA pixel-art-xl', () => {
    expect(findLoraTrigger('pixel-art-xl.safetensors')).toBe('pixel art');
  });

  it('applique un déclencheur générique pour un nom parlant de pixel art', () => {
    expect(findLoraTrigger('my-cool-pixel-art-lora.safetensors')).toBe('pixel art');
    expect(findLoraTrigger('16bit-style.safetensors')).toBe('pixel art');
  });

  it('retourne null quand aucun déclencheur n’est nécessaire', () => {
    expect(findLoraTrigger('add-detail-xl.safetensors')).toBeNull();
    expect(findLoraTrigger('')).toBeNull();
  });

  it('ignore la casse et l’extension', () => {
    expect(findLoraTrigger('PIXELARTREDMOND.SAFETENSORS')).toBe(
      'pixel art, PixArFK',
    );
  });

  it('décrit la LoRA reconnue', () => {
    expect(describeLoraTrigger('PixelArtRedmond15V-PixelArt-PIXARFK.safetensors')).toContain(
      'PixelArtRedmond',
    );
    expect(describeLoraTrigger('inconnue.safetensors')).toBeNull();
  });
});

describe('withTriggerWords', () => {
  it('place les mots-déclencheurs en tête du prompt', () => {
    expect(withTriggerWords('a cute dragon', 'pixel art, PixArFK')).toBe(
      'pixel art, PixArFK, a cute dragon',
    );
  });

  it('ne duplique pas un déclencheur déjà présent', () => {
    const prompt = 'pixel art, PixArFK, a cute dragon';
    expect(withTriggerWords(prompt, 'pixel art, PixArFK')).toBe(prompt);
    expect(withTriggerWords(prompt, 'PIXEL ART, PIXARFK')).toBe(prompt);
  });

  it('nettoie les espaces et virgules superflus', () => {
    expect(withTriggerWords('dragon', '  pixel art,  ')).toBe(
      'pixel art, dragon',
    );
    expect(withTriggerWords('dragon', '   ')).toBe('dragon');
  });
});

describe('intégration aux serveurs IA', () => {
  it('A1111 : les mots-déclencheurs précèdent le prompt et la balise LoRA', () => {
    const cfg = {
      ...defaultServerConfig('a1111'),
      lora: 'PixelArtRedmond15V-PixelArt-PIXARFK',
      loraWeight: 1,
      triggerWords: 'pixel art, PixArFK',
    };
    const payload = buildA1111Payload(cfg, { prompt: 'a blue dragon', seed: 1 });
    expect(payload.prompt).toBe(
      'pixel art, PixArFK, a blue dragon <lora:PixelArtRedmond15V-PixelArt-PIXARFK:1>',
    );
  });

  it('ComfyUI : les mots-déclencheurs sont dans le texte positif', () => {
    const cfg = {
      ...defaultServerConfig('comfyui'),
      checkpoint: 'model.safetensors',
      lora: 'PixelArtRedmond15V-PixelArt-PIXARFK.safetensors',
      triggerWords: 'pixel art, PixArFK',
    };
    const wf = buildComfyWorkflow(cfg, { prompt: 'a blue dragon', seed: 1 });
    expect(wf['3'].inputs.text).toBe('pixel art, PixArFK, a blue dragon');
  });

  it('sans mots-déclencheurs, le prompt reste inchangé', () => {
    const cfg = { ...defaultServerConfig('comfyui'), checkpoint: 'm.safetensors' };
    const wf = buildComfyWorkflow(cfg, { prompt: 'a blue dragon', seed: 1 });
    expect(wf['3'].inputs.text).toBe('a blue dragon');
  });
});
