/** A speech bubble with a pulse line through it: a conversation with a patient. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 8h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H22l-9 8v-8H8a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" />
      <path d="M11 21h7l3-6 5 12 3-6h8" />
    </svg>
  );
}

export function Logo({ inverse = false, compact = false, large = false }: { inverse?: boolean; compact?: boolean; large?: boolean }) {
  return (
    <span className={`flex items-center ${large ? "gap-3" : "gap-2"} ${inverse ? "text-white" : "text-brand-700"}`}>
      <BrandMark className={compact ? "h-6 w-6" : large ? "h-10 w-10" : "h-7 w-7"} />
      <span className={`${compact ? "text-sm" : large ? "text-[24px]" : "text-[16px]"} font-extrabold tracking-[-0.02em]`} style={{ fontFamily: "var(--font-display)" }}>poscere</span>
    </span>
  );
}
