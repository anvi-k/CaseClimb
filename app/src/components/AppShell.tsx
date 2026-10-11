import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/Brand";
import { isFaculty } from "@/lib/auth";
import type { User } from "@/lib/types";

// Kept short on purpose. Care journeys, live visits, progress and the visit archive still exist at
// their own addresses; they are just not offered from the header.
const FACULTY_NAV = [
  { href: "/faculty", label: "My class" },
  { href: "/faculty/cases", label: "Patients" },
];
const STUDENT_NAV = [{ href: "/student", label: "My patients" }];

export default function AppShell({ user, children, wide }: { user: User; children: ReactNode; wide?: boolean }) {
  const faculty = isFaculty(user);
  const nav = faculty ? FACULTY_NAV : STUDENT_NAV;
  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center gap-6 px-6">
          <Link href={faculty ? "/faculty" : "/student"}>
            <Logo />
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-[17px]">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-base">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-medium text-slate-800">{user.name}</div>
              <div className="text-sm text-slate-600">{faculty ? "Instructor" : "Student"}</div>
            </div>
            <form action={logout}>
              <button className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className={wide ? "px-4 py-5" : "mx-auto max-w-7xl px-6 py-10"}>{children}</main>
    </div>
  );
}
