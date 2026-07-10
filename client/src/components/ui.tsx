import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Construction, Sparkles } from 'lucide-react';

export function Card({
  title,
  right,
  children,
  className = '',
  interactive = false,
  icon: Icon,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <div className={`${interactive ? 'card-interactive' : 'card'} ${className}`}>
      {(title || right) && (
        <div className="card-header">
          {title && (
            <h3 className="card-title flex items-center gap-2">
              {Icon && (
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50 text-brand-500">
                  <Icon size={16} />
                </span>
              )}
              {title}
            </h3>
          )}
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Progress({ value, color = 'bg-gradient-to-r from-brand-400 to-brand-500' }: { value: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-700 ease-out relative`}
        style={{ width: `${pct}%` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer bg-[length:200%_100%]" />
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
  active: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
  running: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
  online: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
  live: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
  inactive: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200/60',
  expired: 'bg-rose-100 text-rose-600 ring-1 ring-rose-200/60',
  'non-payment': 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/60',
  disabled: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200/60',
  offline: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/60',
  sent: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
  failed: 'bg-rose-100 text-rose-600 ring-1 ring-rose-200/60',
  'Low Stock': 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/60',
  'Out of Stock': 'bg-rose-100 text-rose-600 ring-1 ring-rose-200/60',
  'In Stock': 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60'}`}>{status}</span>;
}

export function Stat({ label, value, sub, icon: Icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 text-slate-500 shrink-0">
          <Icon size={17} />
        </span>
      )}
      <div>
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'text-slate-800',
  accent = 'from-brand-500/10 to-transparent',
  dot,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: string;
  accent?: string;
  dot?: string;
  delay?: number;
}) {
  return (
    <div
      className="stat-tile animate-fade-in-up"
      style={{ animationDelay: `${delay}ms`, opacity: 0 }}
    >
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl ${accent} rounded-bl-full pointer-events-none`} />
      <div className="relative flex items-center justify-between">
        <div>
          <div className={`text-2xl sm:text-3xl font-bold tracking-tight ${tone}`}>{value}</div>
          <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 font-medium">
            {dot && <span className={`w-2 h-2 rounded-full ${dot} animate-pulse-soft`} />}
            {label}
          </div>
        </div>
        {Icon && (
          <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/80 border border-slate-100 text-slate-400 shadow-sm">
            <Icon size={18} />
          </span>
        )}
      </div>
    </div>
  );
}

export function SectionTitle({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <h2 className="section-title">
      {Icon && <Icon size={14} className="text-brand-500" />}
      {children}
    </h2>
  );
}

export function PageStub({ title, description }: { title: string; description: string }) {
  return (
    <div className="card max-w-2xl mx-auto mt-8 p-12 text-center animate-scale-in">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 mb-5 animate-float">
        <Construction size={28} />
      </div>
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-500 bg-brand-50 px-3 py-1 rounded-full mb-4">
        <Sparkles size={12} />
        Coming soon
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2 tracking-tight">{title}</h2>
      <p className="text-slate-500 max-w-md mx-auto leading-relaxed">{description}</p>
    </div>
  );
}

export function TabPills({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-xl">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={[
            'text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-200',
            active === t.key
              ? 'bg-white text-brand-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700',
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
