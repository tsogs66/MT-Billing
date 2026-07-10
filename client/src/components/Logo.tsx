import { Zap } from 'lucide-react';

type LogoProps = {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  variant?: 'light' | 'dark';
  className?: string;
};

const SIZES = {
  sm: { box: 'w-8 h-8', icon: 16, title: 'text-sm', sub: 'text-[10px]' },
  md: { box: 'w-10 h-10', icon: 20, title: 'text-base', sub: 'text-[11px]' },
  lg: { box: 'w-12 h-12', icon: 24, title: 'text-lg', sub: 'text-xs' },
};

export default function Logo({ size = 'md', showText = true, variant = 'dark', className = '' }: LogoProps) {
  const s = SIZES[size];
  const textMain = variant === 'dark' ? 'text-white' : 'text-slate-900';
  const textSub = variant === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`${s.box} rounded-xl bg-gradient-to-br from-brand-400 via-brand-500 to-brand-600 flex items-center justify-center text-white shadow-glow relative overflow-hidden group`}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <Zap size={s.icon} className="relative z-10 fill-white/20" strokeWidth={2.25} />
        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-brand-300/30 rounded-full blur-md animate-pulse-soft" />
      </div>
      {showText && (
        <div className="min-w-0">
          <div className={`font-bold tracking-tight leading-tight ${s.title} ${textMain}`}>MT-Billing</div>
          <div className={`${s.sub} ${textSub} truncate`}>Pa-North · MikroTik Panel</div>
        </div>
      )}
    </div>
  );
}
