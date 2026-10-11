import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Brand";
import NavLinks from "@/components/NavLinks";
import UserMenu from "@/components/UserMenu";
import { isFaculty } from "@/lib/auth";
import type { User } from "@/lib/types";

// Kept short on purpose. Care journeys, live visits, progress and the visit archive still exist at
// their own addresses; they are just not offered from the header.
const FACULTY_NAV = [
  { href: "/faculty", label: "My class", icon: "school" as const },
  { href: "/faculty/cases", label: "Patients", icon: "users" as const },
];
const STUDENT_NAV = [
  { href: "/student", label: "Home", icon: "users" as const },
  { href: "/student/practice", label: "Practice", icon: "chat" as const },
];

// The three-bar menu holds the pages that are used less often.
const FACULTY_MENU = [
  { href: "/faculty", label: "My class", icon: "school" as const },
  { href: "/faculty/cases", label: "Patients", icon: "users" as const },
];
const STUDENT_MENU = [
  { href: "/student", label: "Home", icon: "users" as const },
  { href: "/student/practice", label: "Practice", icon: "chat" as const },
  { href: "/student/progress", label: "My progress", icon: "chart" as const },
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
              <div className="font-bold text-slate-900">{user.name}</div>
              <div className="text-sm text-slate-600">{faculty ? "Instructor" : "Student"}</div>
            </div>
            <UserMenu links={faculty ? FACULTY_MENU : STUDENT_MENU} />
          </div>
        </div>
      </header>
      <main className={wide ? "px-4 py-5" : "mx-auto max-w-5xl px-6 pb-12 pt-6"}>{children}</main>
    </div>
  );
}
