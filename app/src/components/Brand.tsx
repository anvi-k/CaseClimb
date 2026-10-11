export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <path d="M10.2 5.1A11.5 11.5 0 1 1 5.6 10.7" stroke="currentColor" strokeWidth="3.25" strokeLinecap="round" />
      <path d="M5.1 7.4c.9-2.5 3.1-4.1 5.8-4.1 2.4 0 4.3 1.2 5.4 3.3l-5.1 5.1-6.1-4.3Z" fill="currentColor" />
      <circle cx="11.7" cy="6.2" r=".8" fill="white" />
      <path d="m8.4 8.1 1.15 1.05L10.7 8.1" stroke="white" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${inverse ? "text-white" : "text-brand-700"}`}>
      <BrandMark className={compact ? "h-6 w-6" : "h-7 w-7"} />
      <span className={`${compact ? "text-sm" : "text-[16px]"} font-semibold tracking-[-0.02em]`}>poscere</span>
    </span>
  );
}
