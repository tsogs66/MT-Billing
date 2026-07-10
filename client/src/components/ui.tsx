import type { ReactNode } from 'react';

export function Card({ title, right, children, className = '' }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          {title && <h3 className="font-semibold text-slate-700">{title}</h3>}
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Progress({ value, color = 'bg-brand-500' }: { value: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  active: 'bg-emerald-100 text-emerald-700',
  running: 'bg-emerald-100 text-emerald-700',
  online: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-500',
  expired: 'bg-rose-100 text-rose-600',
  'non-payment': 'bg-amber-100 text-amber-700',
  disabled: 'bg-rose-100 text-rose-700',
  offline: 'bg-amber-100 text-amber-700',
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-600',
  'Low Stock': 'bg-amber-100 text-amber-700',
  'Out of Stock': 'bg-rose-100 text-rose-600',
  'In Stock': 'bg-emerald-100 text-emerald-700',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function PageStub({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-10 text-center max-w-2xl mx-auto mt-6">
      <h2 className="text-xl font-semibold text-slate-700 mb-2">{title}</h2>
      <p className="text-slate-500">{description}</p>
    </div>
  );
}
