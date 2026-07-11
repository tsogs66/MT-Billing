import { useCompany } from '../context/CompanyContext';
import {
  BRAND_SHORT,
  BRAND_TAGLINE,
  DEFAULT_LOGO,
  PRODUCT_TITLE,
} from '../branding';

type LogoProps = {
  size?: 'sm' | 'md' | 'lg' | 'hero';
  showText?: boolean;
  /** Login / marketing: force ts0gs branding text */
  brandMode?: boolean;
  variant?: 'light' | 'dark';
  className?: string;
};

const SIZES = {
  sm: { box: 'w-9 h-9', title: 'text-sm', sub: 'text-[10px]', img: 'h-full w-full' },
  md: { box: 'w-11 h-11', title: 'text-base', sub: 'text-[11px]', img: 'h-full w-full' },
  lg: { box: 'w-14 h-14', title: 'text-lg', sub: 'text-xs', img: 'h-full w-full' },
  hero: { box: 'w-24 h-24 sm:w-28 sm:h-28', title: 'text-2xl', sub: 'text-sm', img: 'h-full w-full' },
};

export default function Logo({
  size = 'md',
  showText = true,
  brandMode = false,
  variant = 'dark',
  className = '',
}: LogoProps) {
  const { company } = useCompany();
  const s = SIZES[size];
  const textMain = variant === 'dark' ? 'text-white' : 'text-slate-900';
  const textSub = variant === 'dark' ? 'text-slate-400' : 'text-slate-500';

  const logoSrc = company?.logo || DEFAULT_LOGO;
  const name = brandMode ? BRAND_SHORT : company?.name?.trim() || BRAND_SHORT;
  const subtitle = brandMode
    ? BRAND_TAGLINE
    : company?.address?.trim() || PRODUCT_TITLE;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`${s.box} rounded-xl bg-white/95 flex items-center justify-center overflow-hidden shadow-glow shrink-0 ring-1 ring-black/5`}
        title={PRODUCT_TITLE}
      >
        <img
          src={logoSrc}
          alt={name}
          className={`${s.img} object-contain object-center p-1`}
        />
      </div>
      {showText && (
        <div className="min-w-0">
          <div className={`font-bold tracking-tight leading-tight truncate ${s.title} ${textMain}`}>{name}</div>
          <div className={`${s.sub} ${textSub} truncate`} title={subtitle}>
            {brandMode ? subtitle : size === 'sm' ? 'v1.0.0 · ts0gs' : subtitle}
          </div>
        </div>
      )}
    </div>
  );
}
