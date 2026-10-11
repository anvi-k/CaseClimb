import { redirect } from "next/navigation";
import { getUser, safeNextPath } from "@/lib/auth";
import AuthForm from "../AuthForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const raw = (await searchParams).next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw) || undefined;
  const u = await getUser();
  if (u) redirect(next || (u.role === "student" ? "/student" : "/faculty"));
  return (
    <>
      <h1 className="mb-1 text-[40px] font-semibold leading-tight text-slate-900">Sign In</h1>
      <p className="mb-7 text-slate-600">{next ? "Sign in to continue to the page you asked for." : "Welcome back."}</p>
      <AuthForm mode="login" next={next} />
      <div className="mt-6 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <div className="mb-1 font-medium text-slate-800">Demo accounts</div>
        Faculty: faculty@poscere.demo / poscere-demo
        <br />
        Student: student@poscere.demo / poscere-demo
      </div>
    </>
  );
}
