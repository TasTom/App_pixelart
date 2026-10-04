import { useState } from 'react';
import { ColorPanel } from './ColorPanel';
import { GenPanel } from './GenPanel';
import { LayersPanel } from './LayersPanel';
import { TilesetPanel } from './TilesetPanel';

export function Sidebar() {
  const [tab, setTab] = useState<'gen' | 'draw'>('gen');

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          type="button"
          className={tab === 'gen' ? 'active' : ''}
          onClick={() => setTab('gen')}
        >
          Génération
        </button>
        <button
          type="button"
          className={tab === 'draw' ? 'active' : ''}
          onClick={() => setTab('draw')}
        >
          Édition
        </button>
      </div>

      {tab === 'gen' ? (
        <GenPanel />
      ) : (
        <>
          <ColorPanel />
          <LayersPanel />
          <TilesetPanel />
        </>
      )}
    </aside>
  );
}
