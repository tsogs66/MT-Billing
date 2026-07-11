/** Format bits-per-second for live traffic columns. */
export function formatBps(bps: number): string {
  const n = Number(bps) || 0;
  if (n <= 0) return '0';
  const mbps = n / 1_000_000;
  if (mbps >= 10) return `${Math.round(mbps)} Mbps`;
  if (mbps >= 0.1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = n / 1000;
  return kbps >= 1 ? `${Math.round(kbps)} Kbps` : `${Math.round(n)} bps`;
}

export function formatTrafficPair(downloadBps?: number | null, uploadBps?: number | null): string {
  return `${formatBps(Number(downloadBps) || 0)} ↓ / ${formatBps(Number(uploadBps) || 0)} ↑`;
}

/** Live traffic cell: green ↓ download, blue ↑ upload. */
export function TrafficPair({
  downloadBps,
  uploadBps,
}: {
  downloadBps?: number | null;
  uploadBps?: number | null;
}) {
  return (
    <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
      {formatBps(Number(downloadBps) || 0)}{' '}
      <span className="text-emerald-600 font-semibold" title="Download">↓</span>
      {' / '}
      {formatBps(Number(uploadBps) || 0)}{' '}
      <span className="text-sky-600 font-semibold" title="Upload">↑</span>
    </span>
  );
}
