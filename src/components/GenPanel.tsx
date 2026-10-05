import { useEffect, useRef, useState } from 'react';
import type { PixelBuffer } from '../types';
import { drawCheckerboard } from '../canvas/compositor';
import { useEditorStore } from '../state/store';
import {
  analyzePrompt,
  buildAiPrompt,
  type ArtStyle,
  type Motion,
} from '../gen/prompt';
import {
  generateAnimation,
  generateSprite,
  PROMPT_EXAMPLES,
} from '../gen/procedural';
import { generateWithAi, type AiModelId } from '../gen/ai';
import {
  defaultServerConfig,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_URLS,
  FALLBACK_SAMPLERS,
  generateOnLocalServer,
  SCHEDULERS,
  testLocalServer,
  type LocalEngineKind,
  type LocalServerConfig,
  type ServerStatus,
} from '../gen/localServer';
import { imageToPixelBuffer } from '../gen/pixelate';

const AI_KEY_STORAGE = 'pixelforge.aikey';
const SERVER_STORAGE = 'pixelforge.server';

type EngineId = 'local' | 'server' | 'ai';
type ResultEngine = 'local' | 'server' | 'ai';

interface GenResult {
  id: string;
  prompt: string;
  frames: PixelBuffer[];
  engine: ResultEngine;
}

const ENGINE_LABELS: Record<ResultEngine, string> = {
  local: 'Local',
  server: 'Serveur local',
  ai: 'IA en ligne',
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

function loadServerConfig(): LocalServerConfig {
  try {
    const saved = window.localStorage.getItem(SERVER_STORAGE);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<LocalServerConfig>;
      return { ...defaultServerConfig(parsed.engine ?? 'a1111'), ...parsed };
    }
  } catch {
    // configuration illisible : valeurs par défaut
  }
  return defaultServerConfig('a1111');
}

export function GenPanel() {
  const newDocFromBuffers = useEditorStore((s) => s.newDocFromBuffers);
  const addLayerFromBuffer = useEditorStore((s) => s.addLayerFromBuffer);

  const [prompt, setPrompt] = useState('un petit dragon bleu avec des ailes');
  const [styleChoice, setStyleChoice] = useState<ArtStyle | 'auto'>('auto');
  const [size, setSize] = useState(32);
  const [motion, setMotion] = useState<Motion>('none');
  const [frameCount, setFrameCount] = useState(4);
  const [variations, setVariations] = useState(2);
  const [engine, setEngine] = useState<EngineId>('local');
  const [apiKey, setApiKey] = useState(() => {
    try {
      return window.localStorage.getItem(AI_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [aiModel, setAiModel] = useState<AiModelId>('gpt-image-1');
  const [useDocPalette, setUseDocPalette] = useState(false);
  const [server, setServer] = useState<LocalServerConfig>(loadServerConfig);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GenResult[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SERVER_STORAGE, JSON.stringify(server));
    } catch {
      // quota ou localStorage indisponible
    }
  }, [server]);

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

  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    const status = await testLocalServer(server);
    setServerStatus(status);
    setTesting(false);
    if (!status.ok) return;
    const patch: Partial<LocalServerConfig> = {};
    if (server.engine === 'comfyui') {
      if (status.models.length > 0 && !status.models.includes(server.checkpoint)) {
        patch.checkpoint = status.models[0];
      }
      if (status.samplers.length > 0 && !status.samplers.includes(server.sampler)) {
        patch.sampler = status.samplers[0];
      }
    } else if (!FALLBACK_SAMPLERS.a1111.includes(server.sampler)) {
      patch.sampler = FALLBACK_SAMPLERS.a1111[0];
    }
    if (Object.keys(patch).length > 0) patchServer(patch);
  };

  const generate = async (): Promise<void> => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const style: ArtStyle =
        styleChoice === 'auto' ? analyzePrompt(text).style : styleChoice;
      const quantizePalette =
        engine !== 'local' && useDocPalette
          ? useEditorStore.getState().doc.palette
          : undefined;
      const maxColors = style === 'gameboy' ? 4 : style === 'nes' ? 16 : 24;
      const created: GenResult[] = [];
      const baseSeed = Math.floor(Math.random() * 1_000_000_000);

      for (let v = 0; v < variations; v++) {
        const seed = baseSeed + v * 7919;
        if (engine === 'local') {
          const frames =
            motion === 'none'
              ? [generateSprite({ prompt: text, seed, size, style })]
              : generateAnimation({
                  prompt: text,
                  seed,
                  size,
                  style,
                  motion,
                  frameCount,
                });
          created.push({
            id: `${seed}-${v}`,
            prompt: text,
            frames,
            engine: 'local',
          });
          continue;
        }

        // Moteurs IA (serveur local ou API en ligne) : une image par frame.
        const count = motion === 'none' ? 1 : Math.min(frameCount, 4);
        const frames: PixelBuffer[] = [];
        for (let f = 0; f < count; f++) {
          const enriched = buildAiPrompt(text, style, motion, f, count);
          const raw =
            engine === 'server'
              ? await generateOnLocalServer(server, {
                  prompt: enriched,
                  seed: seed + f,
                })
              : await generateWithAi({
                  apiKey,
                  model: aiModel,
                  prompt: enriched,
                });
          frames.push(
            imageToPixelBuffer(raw, {
              size,
              transparentBackground: true,
              palette: quantizePalette,
              maxColors,
            }),
          );
        }
        created.push({
          id: `${engine}-${Date.now()}-${v}`,
          prompt: text,
          frames,
          engine,
        });
      }
      setResults((prev) => [...created, ...prev].slice(0, 12));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La génération a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel gen-panel">
      <div className="panel-title">Générer un sprite</div>

      <div className="gen-prompt">
        <textarea
          value={prompt}
          rows={3}
          spellCheck={false}
          placeholder="Décrivez votre sprite… ex : chevalier en armure dorée"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate();
          }}
        />
        <button
          type="button"
          className="primary gen-run"
          disabled={busy || !prompt.trim()}
          onClick={() => void generate()}
        >
          {busy ? 'Génération…' : '✦ Générer'}
        </button>
      </div>

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
          <option value="local">Générateur local (hors-ligne, gratuit)</option>
          <option value="server">Serveur IA local (ComfyUI / A1111)</option>
          <option value="ai">IA en ligne (clé API requise)</option>
        </select>
      </label>

      {engine === 'server' && (
        <div className="server-box">
          <label className="field">
            <span>Serveur</span>
            <select
              value={server.engine}
              onChange={(e) => {
                const kind = e.target.value as LocalEngineKind;
                setServerStatus(null);
                setServer({
                  ...server,
                  engine: kind,
                  baseUrl: DEFAULT_URLS[kind],
                  sampler: FALLBACK_SAMPLERS[kind][0],
                  checkpoint: kind === 'comfyui' ? server.checkpoint : '',
                });
              }}
            >
              <option value="a1111">Automatic1111 / Forge</option>
              <option value="comfyui">ComfyUI</option>
            </select>
          </label>

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
                {serverStatus.ok ? '● connecté' : '● hors ligne'}
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
                    value={server.scheduler}
                    onChange={(e) => patchServer({ scheduler: e.target.value })}
                  >
                    {(serverStatus?.schedulers ?? SCHEDULERS).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
                  onChange={(e) => patchServer({ lora: e.target.value })}
                />
              </label>
            </div>
          )}

          <label className="field">
            <span>Prompt négatif</span>
            <textarea
              rows={2}
              spellCheck={false}
              value={server.negativePrompt}
              placeholder={DEFAULT_NEGATIVE_PROMPT}
              onChange={(e) => patchServer({ negativePrompt: e.target.value })}
            />
          </label>

          <div className="row gap">
            <label className="field grow">
              <span>Étapes : {server.steps}</span>
              <input
                className="slider"
                type="range"
                min={4}
                max={60}
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
              <option value={512}>512 × 512 (SD 1.5)</option>
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
            Astuce : chargez un modèle pixel art (ex. <em>pixel-art-xl</em>,
            <em> PixelArt-Diffusion</em>) ou ajoutez une LoRA pour un rendu net.
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
              onChange={(e) => setAiModel(e.target.value as AiModelId)}
            >
              <option value="gpt-image-1">gpt-image-1 (recommandé)</option>
              <option value="gpt-image-1-mini">gpt-image-1-mini (rapide)</option>
              <option value="dall-e-3">dall-e-3</option>
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
        </>
      )}

      {error && <div className="gen-error">{error}</div>}

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
