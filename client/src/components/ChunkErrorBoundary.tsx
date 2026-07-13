import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

type Props = { children: ReactNode };
type State = { failed: boolean };

const RELOAD_GUARD = 'mtb_chunk_reload';

function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  return (
    /dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk .* failed/i.test(msg)
  );
}

/**
 * Guards the lazily-loaded routes. A failed dynamic import (common on flaky
 * mobile networks, or when a stale tab requests an asset that a new deploy
 * removed) would otherwise unmount React to a blank white screen. We auto
 * reload once to fetch the fresh chunk, then fall back to a manual retry UI.
 */
export default class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error)) {
      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD) === '1';
        sessionStorage.setItem(RELOAD_GUARD, '1');
      } catch {
        /* storage unavailable */
      }
      if (!alreadyReloaded) window.location.reload();
    }
  }

  private retry = () => {
    try {
      sessionStorage.removeItem(RELOAD_GUARD);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-slate-500 max-w-xs">
          This page couldn’t finish loading. Check your connection and try again.
        </p>
        <button type="button" onClick={this.retry} className="btn-primary" data-allow-write>
          <RefreshCw size={16} /> Reload
        </button>
      </div>
    );
  }
}
