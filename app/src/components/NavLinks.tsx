"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header navigation: bold pill links, the current section filled in. */
export default function NavLinks({ nav }: { nav: { href: string; label: string }[] }) {
  const path = usePathname();
  // The longest matching address wins, so "/faculty/cases" does not also light up "/faculty".
  const current = nav.filter((n) => path === n.href || path.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="flex flex-1 items-center justify-center gap-1 overflow-x-auto text-[17px] font-bold">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={n.href === current ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-5 py-2.5 transition-colors ${n.href === current ? "nav-current bg-brand-600" : "text-slate-900 hover:bg-white/10"}`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
