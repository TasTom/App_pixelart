import { useEffect } from 'react';
import { CanvasStage } from './components/CanvasStage';
import { ColorPanel } from './components/ColorPanel';
import { LayersPanel } from './components/LayersPanel';
import { NewDocDialog } from './components/NewDocDialog';
import { StatusBar } from './components/StatusBar';
import { TimelinePanel } from './components/TimelinePanel';
import { TilesetPanel } from './components/TilesetPanel';
import { ToolBar } from './components/ToolBar';
import { TopBar } from './components/TopBar';
import { exportProject, parseProject, serializeProject } from './export/exporters';
import { useEditorStore } from './state/store';

const AUTOSAVE_KEY = 'pixelforge.autosave';

export default function App() {
  // Sauvegarde automatique : restaure la session précédente au démarrage,
  // puis enregistre le document après chaque pause de dessin.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        useEditorStore.getState().loadDoc(parseProject(saved));
      }
    } catch {
      window.localStorage.removeItem(AUTOSAVE_KEY);
    }

    let timer = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          window.localStorage.setItem(
            AUTOSAVE_KEY,
            serializeProject(useEditorStore.getState().doc),
          );
        } catch {
          // Quota dépassé ou localStorage indisponible : on ignore.
        }
      }, 800);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const state = useEditorStore.getState();
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        state.undo();
        return;
      }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        state.redo();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        try {
          exportProject(state.doc);
        } catch (err) {
          window.alert(
            err instanceof Error ? err.message : 'Enregistrement impossible.',
          );
        }
        return;
      }
      if (mod) return;

      switch (key) {
        case 'b':
          state.setUi({ tool: 'pencil' });
          break;
        case 'e':
          state.setUi({ tool: 'eraser' });
          break;
        case 'g':
          state.setUi({ tool: 'fill' });
          break;
        case 'l':
          state.setUi({ tool: 'line' });
          break;
        case 'r':
          state.setUi({ tool: 'rect' });
          break;
        case 'o':
          state.setUi({ tool: 'ellipse' });
          break;
        case 'i':
          state.setUi({ tool: 'eyedropper' });
          break;
        case 'm':
          state.setUi({ tool: 'select' });
          break;
        case 'h':
          state.setUi({ tool: 'pan' });
          break;
        case 'x':
          state.setUi({
            primaryColor: state.secondaryColor,
            secondaryColor: state.primaryColor,
          });
          break;
        case '[':
          state.setUi({ brushSize: Math.max(1, state.brushSize - 1) });
          break;
        case ']':
          state.setUi({ brushSize: Math.min(16, state.brushSize + 1) });
          break;
        case 'arrowleft':
          e.preventDefault();
          state.setUi({ playing: false });
          state.setCurrentFrame(state.currentFrame - 1);
          break;
        case 'arrowright':
          e.preventDefault();
          state.setUi({ playing: false });
          state.setCurrentFrame(state.currentFrame + 1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <ToolBar />
        <div className="center">
          <CanvasStage />
          <TimelinePanel />
        </div>
        <aside className="sidebar">
          <ColorPanel />
          <LayersPanel />
          <TilesetPanel />
        </aside>
      </div>
      <StatusBar />
      <NewDocDialog />
    </div>
  );
}
