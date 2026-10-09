import { useEffect, useRef, useState } from 'react';
import type { PixelBuffer } from '../types';
import { drawCheckerboard } from '../canvas/compositor';
import { useEditorStore } from '../state/store';
import { analyzePrompt, buildAiPrompt, inferAssetKind, PROMPT_EXAMPLES, type AssetKind, type ArtStyle, type Motion, type PlView } from '../gen/prompt';
import { AI_MODELS, DEFAULT_AI_MODEL, blobToRawImage, resolveAiModel, resolveAiQuality, type AiModelId, type AiQuality } from '../gen/ai';
import type { PixelSampling } from '../gen/pixelate';
import {
  defaultServerConfig,
  fluxPixelArtConfig,
  localConfigError,
  loraMatchesFamily,
  DEFAULT_NEGATIVE_PROMPT,
  FALLBACK_SAMPLERS,
  loraToken,
  SCHEDULERS,
  testLocalServer,
  type LocalEngineKind,
  type LocalServerConfig,
  type ServerStatus,
} from '../gen/localServer';
import { describeLoraTrigger, findLoraTrigger, withTriggerWords } from '../gen/loras';
import {
  cancelAllGenerations,
  cancelGeneration,
  enqueueGeneration,
} from '../gen/queue';
import type { GenJob } from '../state/store';

const AI_KEY_STORAGE = 'pixelforge.aikey';
const SERVER_STORAGE = 'pixelforge.server';
const GEN_FORM_STORAGE = 'pixelforge.genform';

type EngineId = 'server' | 'ai';
interface GeneratedExample { id: string; prompt: string }
const EXAMPLE_LABELS: Record<string, string> = { dragon: 'Dragon bleu', knight: 'Chevalier doré', potion: 'Potion violette' };
const SAMPLE_ROOT = `${import.meta.env.BASE_URL}generation-samples/`;

interface GenForm {
  pipelineVersion?: number;
  prompt: string;
  styleChoice: ArtStyle | 'auto';
  size: number;
  motion: Motion;
  frameCount: number;
  variations: number;
  engine: EngineId;
  aiModel: AiModelId;
  useDocPalette: boolean;
  aiQuality: AiQuality;
  assetChoice: AssetKind | 'auto';
  backgroundChoice: 'auto' | 'transparent' | 'keep';
  maxColors: number;
  sampling: PixelSampling;
  seed: string;
  /** Vue/cadrage imposé au modèle. */
  viewChoice: PlView | 'auto';
  /** Stabilité de l'animation (taux de débruitage img2img). */
  animDenoise: number;
}

function loadGenForm(): GenForm {
  const defaults: GenForm = {
    prompt: 'un petit dragon bleu avec des ailes',
    styleChoice: 'auto',
    size: 128,
    motion: 'none',
    frameCount: 4,
    variations: 1,
    engine: 'server',
    pipelineVersion: 4,
    aiModel: DEFAULT_AI_MODEL,
    useDocPalette: false,
    aiQuality: 'high',
    assetChoice: 'auto',
    backgroundChoice: 'auto',
    maxColors: 48,
    sampling: 'dominant',
    seed: '',
    viewChoice: 'auto',
    animDenoise: 0.62,
  };
  try {
    const saved = window.localStorage.getItem(GEN_FORM_STORAGE);
    if (saved) {
      const savedForm = JSON.parse(saved) as Partial<GenForm> & { engine?: string };
      const form = { ...defaults, ...savedForm };
      // Les anciens moteurs (procédural, PixelLab) ont été retirés.
      if (form.engine !== 'server' && form.engine !== 'ai') {
        form.engine = 'server';
        if (savedForm.size === 32) form.size = 128;
      }
      form.aiModel = resolveAiModel(form.aiModel);
      form.aiQuality = resolveAiQuality(form.aiModel, form.aiQuality);
      return form;
    }
  } catch {
    // valeurs par défaut
  }
  return defaults;
}

const ENGINE_LABELS: Record<EngineId, string> = {
  server: 'Serveur local',
  ai: 'IA en ligne',
};

const VIEW_LABELS: Record<PlView, string> = {
  'high top-down': 'Top-down haute (vu de dessus)',
  'low top-down': 'Top-down basse (3/4)',
  side: 'Côté (plateforme)',
};

const JOB_STATUS_LABELS: Record<GenJob['status'], string> = {
  queued: 'En attente',
  running: 'En cours',
  done: 'Terminé',
  error: 'Échec',
  cancelled: 'Annulé',
};

function ResultThumb({ frames }: { frames: PixelBuffer[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (frames.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, 260);
    return () => window.clearInterval(timer);
  }, [frames]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const buf = frames[Math.min(index, frames.length - 1)];
    if (!buf) return;
    const size = 92;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCheckerboard(ctx, 0, 0, size, size, 8);
    const tmp = document.createElement('canvas');
    tmp.width = buf.width;
    tmp.height = buf.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.putImageData(new ImageData(buf.data, buf.width, buf.height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(size / buf.width, size / buf.height);
    const w = buf.width * scale;
    const h = buf.height * scale;
    ctx.drawImage(tmp, (size - w) / 2, (size - h) / 2, w, h);
  }, [frames, index]);

  return <canvas ref={ref} className="result-canvas" />;
}

const MOTIONS: { id: Motion; label: string }[] = [
  { id: 'none', label: 'Sprite fixe' },
  { id: 'walk', label: 'Marche' },
  { id: 'idle', label: 'Repos (idle)' },
  { id: 'attack', label: 'Attaque' },
  { id: 'jump', label: 'Saut' },
];

const STYLES: { id: ArtStyle | 'auto'; label: string }[] = [
  { id: 'auto', label: 'Auto (selon le prompt)' },
  { id: 'rpg', label: 'RPG 16-bit' },
  { id: 'gameboy', label: 'Game Boy (4 couleurs)' },
  { id: 'nes', label: 'NES 8-bit' },
  { id: 'arcade', label: 'Arcade néon' },
  { id: 'cartoon', label: 'Cartoon mignon' },
];

/**
 * Anciens noms de fichiers du profil FLUX.2 Klein, remplacés par les
 * modèles réellement installés sur cette machine (GGUF 9B + Qwen 3 8B).
 * Une configuration enregistrée avant ce changement doit être migrée,
 * sinon ComfyUI refuse le workflow.
 */
const OBSOLETE_KLEIN_FILES: Record<string, string> = {
  'flux-2-klein-4b-fp8.safetensors': 'flux-2-klein-9b-Q4_K_S.gguf',
  'qwen_3_4b_fp4_flux2.safetensors': 'qwen_3_8b_fp8mixed.safetensors',
  'limbicnation-pixel-art-flux2-klein.safetensors': 'klein-spritesheet-lora.safetensors',
};

function loadServerConfig(): LocalServerConfig {
  try {
    const saved = window.localStorage.getItem(SERVER_STORAGE);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<LocalServerConfig>;
      // Upgrade the old bundled SD 1.5/default setup; retain custom server setups.
      if (!parsed.modelFamily && (!parsed.checkpoint || parsed.checkpoint === 'v1-5-pruned-emaonly.safetensors') &&
        (!parsed.lora || /PixelArtRedmond/i.test(parsed.lora))) return fluxPixelArtConfig();
      const merged = {
        ...defaultServerConfig(parsed.engine ?? 'a1111'),
        ...parsed,
      };
      // Migre les fichiers du profil Klein vers ceux installés localement.
      if (merged.modelFamily === 'flux2-klein') {
        for (const key of ['diffusionModel', 'textEncoder', 'vae', 'lora'] as const) {
          const replacement = OBSOLETE_KLEIN_FILES[merged[key] ?? ''];
          if (replacement) merged[key] = replacement;
        }
        // La LoRA de spritesheets Klein n'a pas de mot-déclencheur connu.
        if (merged.lora === 'klein-spritesheet-lora.safetensors') merged.triggerWords = '';
      }
      // Complète les mots-déclencheurs des configurations enregistrées
      // avant l'arrivée de cette fonctionnalité.
      if (merged.lora.trim() && !merged.triggerWords.trim()) {
        merged.triggerWords = findLoraTrigger(merged.lora) ?? '';
      }
      return merged;
    }
  } catch {
    // configuration illisible : valeurs par défaut
  }
  return fluxPixelArtConfig();
}

export function GenPanel() {
  const newDocFromBuffers = useEditorStore((s) => s.newDocFromBuffers);
  const addLayerFromBuffer = useEditorStore((s) => s.addLayerFromBuffer);
  const jobs = useEditorStore((s) => s.genJobs);
  const results = useEditorStore((s) => s.genResults);
  const clearFinishedGenJobs = useEditorStore((s) => s.clearFinishedGenJobs);
  const removeGenJob = useEditorStore((s) => s.removeGenJob);

  const [initial] = useState(loadGenForm);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [styleChoice, setStyleChoice] = useState<ArtStyle | 'auto'>(
    initial.styleChoice,
  );
  const [size, setSize] = useState(initial.size);
  const [motion, setMotion] = useState<Motion>(initial.motion);
  const [frameCount, setFrameCount] = useState(initial.frameCount);
  const [variations, setVariations] = useState(initial.variations);
  const [engine, setEngine] = useState<EngineId>(initial.engine);
  const [apiKey, setApiKey] = useState(() => {
    try {
      return window.localStorage.getItem(AI_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [aiModel, setAiModel] = useState<AiModelId>(initial.aiModel);
  const [useDocPalette, setUseDocPalette] = useState(initial.useDocPalette);
  const [aiQuality, setAiQuality] = useState<AiQuality>(initial.aiQuality);
  const [assetChoice, setAssetChoice] = useState<AssetKind | 'auto'>(initial.assetChoice);
  const [backgroundChoice, setBackgroundChoice] = useState(initial.backgroundChoice);
  const [maxColors, setMaxColors] = useState(initial.maxColors);
  const [sampling, setSampling] = useState<PixelSampling>(initial.sampling);
  const [seed, setSeed] = useState(initial.seed);
  const [viewChoice, setViewChoice] = useState<PlView | 'auto'>(initial.viewChoice);
  const [animDenoise, setAnimDenoise] = useState(initial.animDenoise);
  const [server, setServer] = useState<LocalServerConfig>(loadServerConfig);
  const isFlux = server.engine === 'comfyui' && server.modelFamily === 'flux2-klein';
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [examples, setExamples] = useState<GeneratedExample[]>([]);
  const resolvedStyle = styleChoice === 'auto' ? analyzePrompt(prompt).style : styleChoice;
  const assetKind = assetChoice === 'auto' ? inferAssetKind(prompt) : assetChoice;
  const transparentBackground = backgroundChoice === 'auto'
    ? assetKind === 'sprite' : backgroundChoice === 'transparent';
  const colorBudget = resolvedStyle === 'gameboy' ? 4 : resolvedStyle === 'nes' ? 16 : maxColors;
  const effectiveView: PlView | undefined = viewChoice === 'auto' ? undefined : viewChoice;
  const effectivePrompt = buildAiPrompt(prompt, resolvedStyle, motion, 0, motion === 'none' ? 1 : Math.min(frameCount, 4), {
    size, maxColors: colorBudget, assetKind, transparentBackground, view: effectiveView, provider: engine === 'server' ? isFlux ? 'flux2' : 'server' : 'ai',
  });
  const submittedPrompt = engine === 'server'
    ? (withTriggerWords(effectivePrompt, server.triggerWords) + (server.engine === 'a1111' ? loraToken(server.lora, server.loraWeight) : '')).trim()
    : effectivePrompt;

  const activeCount = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running',
  ).length;
  const finishedCount = jobs.length - activeCount;

  useEffect(() => {
    try {
      window.localStorage.setItem(SERVER_STORAGE, JSON.stringify(server));
    } catch {
      // quota ou localStorage indisponible
    }
  }, [server]);

  // Les réglages du générateur survivent au changement d'onglet.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        GEN_FORM_STORAGE,
        JSON.stringify({
          prompt,
          styleChoice,
          size,
          motion,
          frameCount,
          variations,
          engine,
          aiModel,
          useDocPalette,
          aiQuality, assetChoice, backgroundChoice, maxColors, sampling, seed, viewChoice, animDenoise,
          pipelineVersion: 4,
        }),
      );
    } catch {
      // quota ou localStorage indisponible
    }
  }, [
    prompt,
    styleChoice,
    size,
    motion,
    frameCount,
    variations,
    engine,
    aiModel,
    useDocPalette,
    aiQuality, assetChoice, backgroundChoice, maxColors, sampling, seed, viewChoice, animDenoise,
  ]);

  const saveKey = (value: string): void => {
    setApiKey(value);
    try {
      window.localStorage.setItem(AI_KEY_STORAGE, value);
    } catch {
      // quota ou localStorage indisponible
    }
  };

  const patchServer = (patch: Partial<LocalServerConfig>): void => {
    setServer((prev) => ({ ...prev, ...patch }));
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${SAMPLE_ROOT}validation.json`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const report = await response.json() as { cases?: GeneratedExample[] };
      if (!controller.signal.aborted && Array.isArray(report.cases)) {
        setExamples(report.cases.filter((sample) => sample && Object.hasOwn(EXAMPLE_LABELS, sample.id) && typeof sample.prompt === 'string'));
      }
    }).catch(() => { /* Les exemples sont facultatifs dans un déploiement personnalisé. */ });
    return () => controller.abort();
  }, []);

  const openExample = async (sample: GeneratedExample): Promise<void> => {
    try {
      const response = await fetch(`${SAMPLE_ROOT}${sample.id}-128.png`);
      if (!response.ok) throw new Error('Exemple introuvable.');
      const raw = await blobToRawImage(await response.blob());
      newDocFromBuffers(sample.prompt, [{ ...raw, data: new Uint8ClampedArray(raw.data) }]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Impossible d’ouvrir le sprite.');
    }
  };

  useEffect(() => {
    if (engine !== 'server') return;
    let active = true;
    const timer = window.setTimeout(() => {
      void testLocalServer(server).then((status) => { if (active) setServerStatus(status); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [engine, server]);

  /**
   * Change la LoRA et met à jour les mots-déclencheurs : détectés
   * automatiquement, sauf si l'utilisateur les a saisis à la main.
   */
  const applyLora = (lora: string): void => {
    setServer((prev) => {
      const detected = findLoraTrigger(lora) ?? '';
      const previousAuto = findLoraTrigger(prev.lora) ?? '';
      const custom = prev.triggerWords !== '' && prev.triggerWords !== previousAuto;
      return {
        ...prev,
        lora,
        triggerWords: custom ? prev.triggerWords : detected,
      };
    });
  };

  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setFormError(null);

    const status = await testLocalServer(server);
    setServerStatus(status);
    setTesting(false);
    if (!status.ok) return;
    const patch: Partial<LocalServerConfig> = {};
    if (server.engine === 'comfyui') {
      if (!isFlux && status.models.length > 0 && !status.models.includes(server.checkpoint)) {
        patch.checkpoint = status.models[0];
      }
      if (status.samplers.length > 0 && !status.samplers.includes(server.sampler)) {
        patch.sampler = status.samplers[0];
      }
      if (!isFlux && server.lora.trim() && !status.loras.includes(server.lora.trim())) {
        patch.lora = '';
      }
    } else if (!FALLBACK_SAMPLERS.a1111.includes(server.sampler)) {
      patch.sampler = FALLBACK_SAMPLERS.a1111[0];
    }
    if (Object.keys(patch).length > 0) patchServer(patch);
  };

  const generate = (): void => {
    const text = prompt.trim();
    if (!text) return;
    setFormError(null);

    if (engine !== 'ai' && seed.trim() && (!Number.isSafeInteger(Number(seed)) || Number(seed) < 0 || Number(seed) > 1_000_000_000)) {
      setFormError('La graine doit être un entier entre 0 et 1 000 000 000.');
      return;
    }

    if (engine === 'ai' && !apiKey.trim()) {
      setFormError('Renseignez votre clé API pour le moteur « IA en ligne ».');
      return;
    }
    if (engine === 'server') {
      if (!server.baseUrl.trim()) {
        setFormError('Renseignez l’URL du serveur local.');
        return;
      }
      const configError = localConfigError(server);
      if (configError) {
        setFormError(configError);
        return;
      }
    }

    const style: ArtStyle =
      styleChoice === 'auto' ? analyzePrompt(text).style : styleChoice;

    enqueueGeneration({
      prompt: text,
      engine,
      style,
      size,
      motion,
      frameCount,
      variations,
      assetKind,
      transparentBackground,
      view: effectiveView,
      animDenoise,
      maxColors,
      sampling,
      seed: engine !== 'ai' && seed.trim() ? Number(seed) : undefined,
      palette:
        useDocPalette ? useEditorStore.getState().doc.palette : undefined,
      server: engine === 'server' ? server : undefined,
      ai: engine === 'ai' ? { apiKey, model: aiModel, quality: aiQuality } : undefined,
    });
  };

  return (
    <section className="panel gen-panel">
      <div className="panel-title">Générer du pixel art</div>

      <div className="gen-prompt">
        <textarea
          value={prompt}
          rows={3}
          spellCheck={false}
          aria-label="Description du pixel art"
          placeholder="Sujet, couleurs, accessoires, pose, vue… ex : chevalier en armure dorée, épée bleue, vue de face"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate();
          }}
        />
        <button
          type="button"
          className="primary gen-run"
          disabled={!prompt.trim()}
          onClick={generate}
        >
          ✦ Générer
        </button>
      </div>
      {activeCount > 0 && (
        <div className="hint">
          {activeCount} génération(s) en cours — vous pouvez continuer à
          dessiner pendant ce temps.
        </div>
      )}

      <div className="chip-row">
        {PROMPT_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip"
            onClick={() => setPrompt(example)}
            title={example}
          >
            {example.length > 22 ? `${example.slice(0, 22)}…` : example}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Style</span>
        <select
          value={styleChoice}
          onChange={(e) => setStyleChoice(e.target.value as ArtStyle | 'auto')}
        >
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="row gap">
        <label className="field grow">
          <span>Taille</span>
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            <option value={16}>16 × 16</option>
            <option value={24}>24 × 24</option>
            <option value={32}>32 × 32</option>
            <option value={48}>48 × 48</option>
            <option value={64}>64 × 64</option>
            <option value={128}>128 × 128 (détaillé)</option>
            <option value={256}>256 × 256 (illustration)</option>
          </select>
        </label>
        <label className="field grow">
          <span>Mouvement</span>
          <select
            value={motion}
            onChange={(e) => setMotion(e.target.value as Motion)}
          >
            {MOTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row gap">
        {motion !== 'none' && (
          <label className="field grow">
            <span>Images</span>
            <select
              value={frameCount}
              onChange={(e) => setFrameCount(Number(e.target.value))}
            >
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={6}>6</option>
              <option value={8}>8</option>
            </select>
          </label>
        )}
        <label className="field grow">
          <span>Variantes</span>
          <select
            value={variations}
            onChange={(e) => setVariations(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>Moteur</span>
        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value as EngineId)}
        >
          <option value="server">Serveur IA local (ComfyUI / A1111)</option>
          <option value="ai">IA en ligne (clé API requise)</option>
        </select>
      </label>

      {engine !== 'ai' && (
        <>
          <label className="field">
            <span>Format du résultat</span>
            <select value={assetChoice} onChange={(e) => setAssetChoice(e.target.value as AssetKind | 'auto')}>
              <option value="auto">Auto : {assetKind === 'sprite' ? 'sprite isolé' : assetKind === 'scene' ? 'scène complète' : 'tuile de terrain'}</option>
              <option value="sprite">Sprite isolé</option>
              <option value="scene">Scène / illustration (avec décor)</option>
              <option value="tile">Tuile de terrain</option>
            </select>
          </label>
          <label className="field">
            <span>Vue</span>
            <select value={viewChoice} onChange={(e) => setViewChoice(e.target.value as PlView | 'auto')}>
              <option value="auto">Auto : {assetKind === 'tile' ? 'top-down haute' : 'top-down basse'}</option>
              {(Object.keys(VIEW_LABELS) as PlView[]).map((view) => (
                <option key={view} value={view}>{VIEW_LABELS[view]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Fond</span>
            <select value={backgroundChoice} onChange={(e) => setBackgroundChoice(e.target.value as GenForm['backgroundChoice'])}>
              <option value="auto">Auto : {transparentBackground ? 'transparent' : 'conservé'}</option>
              <option value="transparent">Transparent (détourage)</option>
              <option value="keep">Conserver le fond</option>
            </select>
          </label>
          {transparentBackground && <div className="hint">Le fond uni et les franges claires sont retirés automatiquement ; les reflets à l’intérieur du sprite sont conservés.</div>}
          <div className="row gap">
            <label className="field grow">
              <span>Couleurs max.</span>
              <select value={colorBudget} disabled={resolvedStyle === 'gameboy' || resolvedStyle === 'nes' || useDocPalette} onChange={(e) => setMaxColors(Number(e.target.value))}>
                {[4, 16, 24, 32, 48, 64].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="field grow">
              <span>Réduction</span>
              <select value={sampling} onChange={(e) => setSampling(e.target.value as PixelSampling)}>
                <option value="dominant">Pixels nets</option>
                <option value="average">Couleurs moyennes</option>
              </select>
            </label>
          </div>
          <div className="hint">64 à 128 px et 32 à 48 couleurs permettent de garder davantage de détails. Une palette imposée peut modifier les couleurs du prompt.</div>
          {motion !== 'none' && engine === 'server' && (
            <label className="field">
              <span>Stabilité de l’animation : {Math.round(animDenoise * 100)} %</span>
              <input
                className="slider"
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={animDenoise}
                onChange={(e) => setAnimDenoise(Number(e.target.value))}
              />
              <span className="hint">
                {animDenoise <= 0.5
                  ? 'Poses subtiles, personnage très stable — idéal pour un repos.'
                  : animDenoise <= 0.75
                    ? 'Bon équilibre entre mouvement et stabilité — marche, attaque.'
                    : 'Poses très marquées, mais l’identité du personnage peut dériver.'}
              </span>
            </label>
          )}
          {motion !== 'none' && <div className="hint">
            {engine === 'server'
              ? 'Animation par img2img séquentiel : la première image est créée, puis chaque pose est générée depuis la précédente. Le personnage garde son identité et son alignement.'
              : 'Animation IA : jusqu’à 4 images générées séparément. L’identité et l’alignement peuvent varier entre les poses.'}
          </div>}
          <details className="gen-prompt-preview">
            <summary>Voir le prompt envoyé au moteur</summary>
            <pre>{submittedPrompt}</pre>
            {engine === 'server' && !isFlux && <><span>Prompt négatif</span><pre>{server.negativePrompt}</pre></>}
          </details>
        </>
      )}

      {engine !== 'ai' && <label className="field">
        <span>Graine (vide = aléatoire)</span>
        <input type="number" min={0} max={1_000_000_000} step={1} value={seed} placeholder="Ex. 42, pour reproduire le résultat" onChange={(e) => setSeed(e.target.value)} />
      </label>}

      {engine === 'server' && (
        <div className="server-box">
          <label className="field">
            <span>Serveur</span>
            <select
              value={server.engine}
              onChange={(e) => {
                const kind = e.target.value as LocalEngineKind;
                setServerStatus(null);
                setServer(kind === 'comfyui' ? fluxPixelArtConfig() : defaultServerConfig(kind));
              }}
            >
              <option value="a1111">Automatic1111 / Forge</option>
              <option value="comfyui">ComfyUI</option>
            </select>
          </label>

          {server.engine === 'comfyui' && <>
            <label className="field">
              <span>Profil du modèle</span>
              <select value={server.modelFamily ?? 'sd'} onChange={(e) => {
                setServerStatus(null);
                setServer(e.target.value === 'flux2-klein'
                  ? { ...fluxPixelArtConfig(), baseUrl: server.baseUrl }
                  : { ...defaultServerConfig('comfyui'), baseUrl: server.baseUrl, modelFamily: 'sd' });
              }}>
                <option value="flux2-klein">FLUX.2 Klein — pixel art (recommandé)</option>
                <option value="sd">Stable Diffusion / SDXL — configuration manuelle</option>
              </select>
            </label>
            {isFlux && <div className="gen-guidance">
              <strong>FLUX.2 Klein + LoRA de sprites</strong>
              <p>Modèle ouvert sous Apache 2.0. Le profil utilise 4 étapes, Euler et une résolution adaptée à la taille du sprite. Le chargement prend quelques secondes sur une carte de 12 Go.</p>
              <p>Si des fichiers manquent, testez la connexion : elle indique précisément lesquels.</p>
            </div>}
          </>}

          <label className="field">
            <span>URL du serveur</span>
            <input
              type="text"
              spellCheck={false}
              value={server.baseUrl}
              onChange={(e) => patchServer({ baseUrl: e.target.value })}
            />
          </label>

          <div className="row gap">
            <button
              type="button"
              className="small"
              disabled={testing}
              onClick={() => void testConnection()}
            >
              {testing ? 'Test…' : 'Tester la connexion'}
            </button>
            {serverStatus && (
              <span
                className={`server-status ${serverStatus.ok ? 'ok' : 'ko'}`}
                title={serverStatus.message}
              >
                {serverStatus.ok ? '● prêt' : '● à configurer'}
              </span>
            )}
          </div>

          {serverStatus && (
            <div className={`server-message ${serverStatus.ok ? 'ok' : 'ko'}`}>
              {serverStatus.message}
            </div>
          )}

          {serverStatus?.ok &&
            server.engine === 'a1111' &&
            serverStatus.activeModel && (
              <div className="hint">
                Modèle actif : <strong>{serverStatus.activeModel}</strong> —
                changez de modèle dans l’interface de votre serveur (chargez
                votre modèle pixel art, ou SDXL + LoRA).
              </div>
            )}

          {server.engine === 'comfyui' && (
            <>
              {isFlux ? <>
                {([
                  ['diffusionModel', 'Modèle FLUX.2', serverStatus?.diffusionModels],
                  ['textEncoder', 'Encodeur Qwen', serverStatus?.textEncoders],
                  ['vae', 'VAE FLUX.2', serverStatus?.vaes],
                ] as const).map(([key, label, files]) => <label key={key} className="field">
                  <span>{label}</span>
                  <select value={server[key] ?? ''} onChange={(e) => patchServer({ [key]: e.target.value })}>
                    {Array.from(new Set([server[key] ?? '', ...(files ?? [])])).filter(Boolean).map((file) => <option key={file} value={file}>{file}</option>)}
                  </select>
                </label>)}
              </> :
              <label className="field">
                <span>Checkpoint</span>
                <select
                  value={server.checkpoint}
                  onChange={(e) => patchServer({ checkpoint: e.target.value })}
                >
                  {server.checkpoint === '' && (
                    <option value="">— testez la connexion —</option>
                  )}
                  {(serverStatus?.models ?? [server.checkpoint])
                    .filter((m) => m.length > 0)
                    .map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                </select>
              </label>
              }

              <div className="row gap">
                <label className="field grow">
                  <span>Sampler</span>
                  <select
                    value={server.sampler}
                    onChange={(e) => patchServer({ sampler: e.target.value })}
                  >
                    {(serverStatus?.samplers ?? FALLBACK_SAMPLERS.comfyui).map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="field grow">
                  <span>Planificateur</span>
                  <select
                    value={isFlux ? 'flux2' : server.scheduler}
                    disabled={isFlux}
                    onChange={(e) => patchServer({ scheduler: e.target.value })}
                  >
                    {(isFlux ? ['flux2'] : serverStatus?.schedulers ?? SCHEDULERS).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="row gap">
                <label className="field grow">
                  <span>LoRA pixel art</span>
                  <select
                    value={server.lora}
                    onChange={(e) => applyLora(e.target.value)}
                  >
                    <option value="">— aucune —</option>
                    {Array.from(new Set([server.lora, ...(serverStatus?.loras ?? [])])).filter((lora) => lora && loraMatchesFamily(lora, server.modelFamily)).map((lora) => (
                      <option key={lora} value={lora}>
                        {lora}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span>Poids : {server.loraWeight.toFixed(2)}</span>
                  <input
                    className="slider"
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={server.loraWeight}
                    disabled={server.lora.trim().length === 0}
                    onChange={(e) =>
                      patchServer({ loraWeight: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              {serverStatus?.ok && serverStatus.loras.length === 0 && (
                <div className="hint">
                  Aucune LoRA détectée par ComfyUI (placez-les dans{' '}
                  <code>models/loras</code>).
                </div>
              )}
            </>
          )}

          {server.engine === 'a1111' && (
            <div className="row gap">
              <label className="field grow">
                <span>Sampler</span>
                <input
                  type="text"
                  spellCheck={false}
                  value={server.sampler}
                  onChange={(e) => patchServer({ sampler: e.target.value })}
                />
              </label>
              <label className="field grow">
                <span>LoRA pixel art</span>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="pixel-art-xl"
                  value={server.lora}
                  onChange={(e) => applyLora(e.target.value)}
                />
              </label>
            </div>
          )}

          <label className="field">
            <span>Mots-déclencheurs (ajoutés en tête de prompt)</span>
            <input
              type="text"
              spellCheck={false}
              placeholder="pixel art, PixArFK"
              value={server.triggerWords}
              onChange={(e) => patchServer({ triggerWords: e.target.value })}
            />
          </label>
          {server.lora.trim().length > 0 && (
            <div className="hint">
              {findLoraTrigger(server.lora)
                ? `Déclencheur détecté automatiquement${
                    describeLoraTrigger(server.lora)
                      ? ` (${describeLoraTrigger(server.lora)})`
                      : ''
                  }. Il n’est ajouté qu’une fois, même si vous l’écrivez déjà dans le prompt.`
                : 'Aucun mot-déclencheur connu pour cette LoRA — laissez vide si elle n’en nécessite pas.'}
            </div>
          )}

          {!isFlux && <label className="field">
            <span>Prompt négatif</span>
            <textarea
              rows={2}
              spellCheck={false}
              value={server.negativePrompt}
              placeholder={DEFAULT_NEGATIVE_PROMPT}
              onChange={(e) => patchServer({ negativePrompt: e.target.value })}
            />
          </label>}

          <div className="row gap">
            <label className="field grow">
              <span>Étapes : {server.steps}</span>
              <input
                className="slider"
                type="range"
                min={4}
                max={isFlux ? 8 : 60}
                value={server.steps}
                onChange={(e) => patchServer({ steps: Number(e.target.value) })}
              />
            </label>
            <label className="field grow">
              <span>CFG</span>
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={server.cfgScale}
                disabled={isFlux}
                onChange={(e) => patchServer({ cfgScale: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="field">
            <span>Résolution du modèle</span>
            <select
              value={server.resolution}
              onChange={(e) =>
                patchServer({ resolution: Number(e.target.value) })
              }
            >
              <option value={512}>512 × 512 {isFlux ? '(sprites, recommandé)' : '(SD 1.5)'}</option>
              <option value={768}>768 × 768</option>
              <option value={1024}>1024 × 1024 (SDXL / Flux)</option>
            </select>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={useDocPalette}
              onChange={(e) => setUseDocPalette(e.target.checked)}
            />
            Quantifier vers la palette du document
          </label>

          <div className="hint">
            Activez l’API et le CORS sur votre serveur :
            <br />
            <code>
              {server.engine === 'a1111'
                ? './webui.sh --api --cors-allow-origins=*'
                : 'python main.py --enable-cors-header'}
            </code>
            <br />
            {isFlux ? 'Le fond uni du sprite est retiré par PixelForge après génération.' : 'Chargez un modèle pixel art ou une LoRA compatible avec votre checkpoint.'}
          </div>
        </div>
      )}

      {engine === 'ai' && (
        <>
          <label className="field">
            <span>Clé API (stockée uniquement dans votre navigateur)</span>
            <input
              type="password"
              value={apiKey}
              placeholder="sk-…"
              spellCheck={false}
              onChange={(e) => saveKey(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Modèle</span>
            <select
              value={aiModel}
              onChange={(e) => {
                const model = resolveAiModel(e.target.value);
                setAiModel(model);
                setAiQuality((quality) => resolveAiQuality(model, quality));
              }}
            >
              {AI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Qualité IA</span>
            <select value={aiQuality} onChange={(e) => setAiQuality(e.target.value as AiQuality)}>
              <option value="low">Brouillon (rapide)</option>
              <option value="medium">Équilibrée</option>
              <option value="high">Haute</option>
              {AI_MODELS.find((model) => model.id === aiModel)?.extendedQuality && <>
                <option value="xhigh">Très haute</option>
                <option value="max">Maximale</option>
              </>}
            </select>
          </label>
          <div className="hint">Chaque image utilise votre quota API. Une qualité plus élevée peut augmenter le coût et le temps de génération.</div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={useDocPalette}
              onChange={(e) => setUseDocPalette(e.target.checked)}
            />
            Quantifier vers la palette du document
          </label>
        </>
      )}

      {formError && <div className="gen-error">{formError}</div>}

      {examples.length > 0 && <details className="gen-examples">
        <summary>Exemples générés avec FLUX.2 Klein</summary>
        <div className="hint">Sprites de 128 px avec fond transparent. Ouvrez-les pour les modifier ou reprenez leur description.</div>
        <div className="result-grid">
          {examples.map((sample) => <div className="result-card" key={sample.id}>
            <img className="sample-preview" src={`${SAMPLE_ROOT}${sample.id}-128.png`} alt={sample.prompt} width={128} height={128} loading="lazy" />
            <div className="result-meta">{EXAMPLE_LABELS[sample.id]}</div>
            <div className="result-actions">
              <button className="small" type="button" onClick={() => void openExample(sample)}>Ouvrir</button>
              <button className="small" type="button" onClick={() => setPrompt(sample.prompt)}>Prompt</button>
            </div>
          </div>)}
        </div>
      </details>}

      {jobs.length > 0 && (
        <>
          <div className="panel-title row-between">
            <span>
              File d’attente{jobs.length > 0 ? ` (${jobs.length})` : ''}
            </span>
            <span className="row gap">
              {activeCount > 0 && (
                <button
                  type="button"
                  className="small"
                  onClick={() => cancelAllGenerations()}
                >
                  Tout annuler
                </button>
              )}
              {finishedCount > 0 && (
                <button
                  type="button"
                  className="small"
                  onClick={() => clearFinishedGenJobs()}
                >
                  Vider
                </button>
              )}
            </span>
          </div>

          <div className="job-list">
            {jobs.map((job) => (
              <div key={job.id} className={`job-row ${job.status}`}>
                <div className="job-head">
                  <span className={`badge ${job.status}`}>
                    {JOB_STATUS_LABELS[job.status]}
                  </span>
                  <span className="job-prompt" title={job.prompt}>
                    {job.prompt}
                  </span>
                  {job.status === 'queued' || job.status === 'running' ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Annuler"
                      onClick={() => cancelGeneration(job.id)}
                    >
                      ✕
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Retirer"
                      onClick={() => removeGenJob(job.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className={`job-detail ${job.error ? 'ko' : ''}`}>
                  {job.error ?? job.detail}
                </div>
                {(job.status === 'running' || job.status === 'queued') && (
                  <div className="progress">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round(job.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="panel-title">
        Résultats {results.length > 0 && `(${results.length})`}
      </div>
      {results.length === 0 && (
        <div className="hint">
          Décrivez un personnage, un objet, un décor ou une tile, puis cliquez
          sur « Générer ». Choisissez « Marche », « Attaque » ou « Saut » pour
          créer une animation directement.
        </div>
      )}

      <div className="result-grid">
        {results.map((result) => (
          <div key={result.id} className="result-card">
            <ResultThumb frames={result.frames} />
            <div className="result-meta">
              <span className="badge">{ENGINE_LABELS[result.engine]}</span>
              {result.frames.length > 1 && (
                <span className="badge">{result.frames.length} img</span>
              )}
            </div>
            <div className="result-actions">
              <button
                type="button"
                className="small"
                onClick={() => newDocFromBuffers(result.prompt, result.frames)}
              >
                Document
              </button>
              <button
                type="button"
                className="small"
                onClick={() =>
                  addLayerFromBuffer(result.frames[0], result.prompt.slice(0, 24))
                }
              >
                Calque
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
