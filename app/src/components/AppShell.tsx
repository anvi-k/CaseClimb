import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/Brand";
import NavLinks from "@/components/NavLinks";
import { isFaculty } from "@/lib/auth";
import type { User } from "@/lib/types";

// Kept short on purpose. Care journeys, live visits, progress and the visit archive still exist at
// their own addresses; they are just not offered from the header.
const FACULTY_NAV = [
  { href: "/faculty", label: "My class" },
  { href: "/faculty/cases", label: "Patients" },
];
const STUDENT_NAV = [
  { href: "/student", label: "My patients" },
  { href: "/student/practice", label: "Practice" },
];

export default function AppShell({ user, children, wide }: { user: User; children: ReactNode; wide?: boolean }) {
  const faculty = isFaculty(user);
  const nav = faculty ? FACULTY_NAV : STUDENT_NAV;
  return (
    <div className="min-h-full">
      <header>
        <div className="mx-auto flex h-[92px] max-w-7xl items-center gap-6 px-6">
          <Link href={faculty ? "/faculty" : "/student"} className="flex-none">
            <Logo large />
          </Link>
          <NavLinks nav={nav} />
          <div className="flex flex-none items-center gap-4 text-base">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-semibold text-slate-900">{user.name}</div>
              <div className="text-sm text-slate-600">{faculty ? "Instructor" : "Student"}</div>
            </div>
            <form action={logout}>
              <button className="rounded-full border border-slate-400 px-4 py-2 font-semibold text-slate-900 transition-colors hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className={wide ? "px-4 py-5" : "mx-auto max-w-5xl px-6 pb-12 pt-6"}>{children}</main>
    </div>
  );
}
