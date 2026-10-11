import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/Brand";
import { isFaculty } from "@/lib/auth";
import { profession } from "@/lib/professions";
import type { User } from "@/lib/types";

const FACULTY_NAV = [
  { href: "/faculty", label: "Home" },
  { href: "/faculty/cases", label: "Patient Studio" },
  { href: "/faculty/journeys", label: "Care Journeys" },
  { href: "/faculty/courses", label: "Courses" },
  { href: "/faculty/live", label: "Live Visits" },
  { href: "/episodes", label: "Episodes" },
];
const STUDENT_NAV = [
  { href: "/student", label: "Home" },
  { href: "/student/practice", label: "Practice" },
  { href: "/student/journeys", label: "Care Journeys" },
  { href: "/student/progress", label: "Progress" },
  { href: "/episodes", label: "My visits" },
];

export default function AppShell({ user, children, wide }: { user: User; children: ReactNode; wide?: boolean }) {
  const faculty = isFaculty(user);
  const nav = faculty ? FACULTY_NAV : STUDENT_NAV;
  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href={faculty ? "/faculty" : "/student"}>
            <Logo />
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {n.label}
              </Link>
            ))}
            {faculty && (
              <Link href="/student" className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                Student view
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-medium text-slate-800">{user.name}</div>
              <div className="text-xs text-slate-500">{faculty ? "Faculty" : profession(user.profession_id).name}</div>
            </div>
            <form action={logout}>
              <button className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className={wide ? "px-4 py-5" : "mx-auto max-w-7xl px-4 py-6"}>{children}</main>
    </div>
  );
}
