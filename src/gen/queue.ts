/**
 * File d'attente de génération : les demandes sont traitées une par une
 * (un serveur local ne peut générer qu'une image à la fois), avec
 * progression, annulation et persistance entre les onglets.
 */
import { useEditorStore } from '../state/store';
import {
  GenerationCancelled,
  runGeneration,
  type GenerationSpec,
} from './runner';

interface QueueItem {
  id: string;
  spec: GenerationSpec;
}

const pending: QueueItem[] = [];
const controllers = new Map<string, AbortController>();
let processing = false;
let counter = 0;

function nextId(): string {
  counter += 1;
  return `job-${Date.now().toString(36)}-${counter}`;
}

/** Ajoute une génération à la file et démarre le traitement. */
export function enqueueGeneration(spec: GenerationSpec): string {
  const id = nextId();
  useEditorStore.getState().addGenJob({
    id,
    prompt: spec.prompt,
    engine: spec.engine,
    status: 'queued',
    progress: 0,
    detail: 'En attente…',
  });
  pending.push({ id, spec });
  void processQueue();
  return id;
}

/** Annule une génération (en attente ou en cours). */
export function cancelGeneration(id: string): void {
  const index = pending.findIndex((item) => item.id === id);
  if (index >= 0) {
    pending.splice(index, 1);
    useEditorStore
      .getState()
      .updateGenJob(id, { status: 'cancelled', detail: 'Annulé', progress: 0 });
    return;
  }
  controllers.get(id)?.abort();
}

/** Annule toutes les générations (file et en cours). */
export function cancelAllGenerations(): void {
  const store = useEditorStore.getState();
  for (const item of pending.splice(0, pending.length)) {
    store.updateGenJob(item.id, {
      status: 'cancelled',
      detail: 'Annulé',
      progress: 0,
    });
  }
  for (const controller of controllers.values()) controller.abort();
}

/** Nombre de générations en attente ou en cours. */
export function activeGenerationCount(): number {
  return useEditorStore
    .getState()
    .genJobs.filter((job) => job.status === 'queued' || job.status === 'running')
    .length;
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (pending.length > 0) {
      const item = pending.shift() as QueueItem;
      const controller = new AbortController();
      controllers.set(item.id, controller);
      const store = useEditorStore.getState();
      store.updateGenJob(item.id, {
        status: 'running',
        progress: 0,
        detail: 'Démarrage…',
        error: undefined,
      });

      try {
        const outcome = await runGeneration(
          item.spec,
          (info) => {
            useEditorStore.getState().updateGenJob(item.id, {
              progress: info.progress,
              detail: info.detail,
            });
          },
          controller.signal,
        );

        useEditorStore.getState().addGenResults(
          outcome.variations.map((frames, index) => ({
            id: `${item.id}-${index}`,
            prompt: outcome.prompt,
            frames,
            engine: outcome.engine,
          })),
        );
        useEditorStore.getState().updateGenJob(item.id, {
          status: 'done',
          progress: 1,
          detail: `${outcome.variations.length} résultat(s) prêt(s)`,
        });
      } catch (err) {
        const cancelled = err instanceof GenerationCancelled || controller.signal.aborted;
        useEditorStore.getState().updateGenJob(item.id, {
          status: cancelled ? 'cancelled' : 'error',
          detail: cancelled ? 'Annulé' : 'Échec',
          error:
            cancelled || !(err instanceof Error) ? undefined : err.message,
        });
      } finally {
        controllers.delete(item.id);
      }
    }
  } finally {
    processing = false;
  }
}
