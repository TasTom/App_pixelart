import { useEffect, useRef } from 'react';
import { drawCheckerboard } from '../canvas/compositor';
import { flattenFrame } from '../core/compose';
import { useEditorStore } from '../state/store';

function FrameThumb({ index }: { index: number }) {
  const docRev = useEditorStore((s) => s.docRev);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const state = useEditorStore.getState();
    if (index >= state.doc.frames.length) return;
    const flat = flattenFrame(state.doc, index);
    const size = 52;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCheckerboard(ctx, 0, 0, size, size, 6);
    const tmp = document.createElement('canvas');
    tmp.width = flat.width;
    tmp.height = flat.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.putImageData(new ImageData(flat.data, flat.width, flat.height), 0, 0);
    const scale = Math.min(size / flat.width, size / flat.height);
    const w = flat.width * scale;
    const h = flat.height * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, (size - w) / 2, (size - h) / 2, w, h);
  }, [index, docRev]);

  return <canvas ref={ref} className="thumb-canvas" />;
}

export function TimelinePanel() {
  const frames = useEditorStore((s) => s.doc.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const playing = useEditorStore((s) => s.playing);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const setUi = useEditorStore((s) => s.setUi);
  const setCurrentFrame = useEditorStore((s) => s.setCurrentFrame);
  const addFrame = useEditorStore((s) => s.addFrame);
  const deleteFrame = useEditorStore((s) => s.deleteFrame);
  const moveFrame = useEditorStore((s) => s.moveFrame);
  const setFrameDuration = useEditorStore((s) => s.setFrameDuration);

  // Lecture : avance automatiquement selon la durée de chaque image.
  useEffect(() => {
    if (!playing) return;
    const state = useEditorStore.getState();
    const duration = state.doc.frames[state.currentFrame]?.durationMs ?? 120;
    const timer = window.setTimeout(() => {
      const s = useEditorStore.getState();
      const count = s.doc.frames.length;
      if (count > 0) s.setCurrentFrame((s.currentFrame + 1) % count);
    }, Math.max(20, duration));
    return () => window.clearTimeout(timer);
  }, [playing, currentFrame, frames]);

  return (
    <section className="timeline">
      <div className="timeline-controls">
        <button
          type="button"
          title="Première image"
          onClick={() => {
            setUi({ playing: false });
            setCurrentFrame(0);
          }}
        >
          ⏮
        </button>
        <button
          type="button"
          title="Image précédente"
          onClick={() => {
            setUi({ playing: false });
            setCurrentFrame(currentFrame - 1);
          }}
        >
          ◀
        </button>
        <button
          type="button"
          className={playing ? 'active' : ''}
          onClick={() => setUi({ playing: !playing })}
        >
          {playing ? '⏸ Pause' : '▶ Lecture'}
        </button>
        <button
          type="button"
          title="Image suivante"
          onClick={() => {
            setUi({ playing: false });
            setCurrentFrame(currentFrame + 1);
          }}
        >
          ▶
        </button>
        <button
          type="button"
          title="Dernière image"
          onClick={() => {
            setUi({ playing: false });
            setCurrentFrame(frames.length - 1);
          }}
        >
          ⏭
        </button>

        <span className="timeline-label">
          Image {currentFrame + 1} / {frames.length}
        </span>

        <label className="check-row">
          <input
            type="checkbox"
            checked={onionSkin}
            onChange={(e) => setUi({ onionSkin: e.target.checked })}
          />
          Pelure d&apos;oignon
        </label>

        <label className="dur-field">
          Durée (ms)
          <input
            key={`${currentFrame}-${frames[currentFrame]?.durationMs}`}
            type="number"
            min={20}
            max={10000}
            defaultValue={frames[currentFrame]?.durationMs ?? 120}
            onBlur={(e) =>
              setFrameDuration(currentFrame, Number(e.target.value))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setFrameDuration(currentFrame, Number(e.currentTarget.value));
              }
            }}
          />
        </label>

        <span className="spacer" />

        <button type="button" className="small" onClick={() => addFrame(false)}>
          + Image
        </button>
        <button type="button" className="small" onClick={() => addFrame(true)}>
          + Dupliquer
        </button>
        <button
          type="button"
          className="small"
          disabled={frames.length <= 1}
          onClick={() => deleteFrame(currentFrame)}
        >
          Supprimer
        </button>
        <button
          type="button"
          className="small"
          title="Déplacer vers la gauche"
          onClick={() => moveFrame(currentFrame, -1)}
        >
          ←
        </button>
        <button
          type="button"
          className="small"
          title="Déplacer vers la droite"
          onClick={() => moveFrame(currentFrame, 1)}
        >
          →
        </button>
      </div>

      <div className="frame-strip">
        {frames.map((frame, i) => (
          <button
            key={frame.id}
            type="button"
            className={`frame-thumb ${i === currentFrame ? 'active' : ''}`}
            onClick={() => {
              setUi({ playing: false });
              setCurrentFrame(i);
            }}
          >
            <FrameThumb index={i} />
            <span className="frame-index">{i + 1}</span>
            <span className="frame-dur">{frame.durationMs} ms</span>
          </button>
        ))}
      </div>
    </section>
  );
}
