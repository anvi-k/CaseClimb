"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/(auth)/actions";
import Icon, { type IconName } from "@/components/Icon";

/** The three-bar button in the header: a dropdown with the less-used pages and Sign out. */
export default function UserMenu({ links }: { links: { href: string; label: string; icon?: IconName }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = "flex w-full items-center gap-3 rounded-xl px-5 py-3 text-left text-[17px] font-bold text-white hover:bg-white/10";
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-400 bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="user-menu fade-in absolute right-0 top-full z-50 mt-3 w-64 rounded-3xl border border-white/10 p-3 shadow-2xl">
          {links.map((l) => (
            <Link key={l.href} href={l.href} role="menuitem" onClick={() => setOpen(false)} className={item}>
              {l.icon && <Icon name={l.icon} className="h-5 w-5 text-brand-600" />}
              {l.label}
            </Link>
          ))}
          <form action={logout}>
            <button role="menuitem" className={item}>
              <Icon name="logout" className="h-5 w-5 text-brand-600" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
