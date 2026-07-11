import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/** Render children into document.body so fixed overlays center on the viewport. */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
