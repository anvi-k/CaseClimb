import Link from "next/link";
import AppShell from "@/components/AppShell";
import TemperamentPicker from "@/components/courses/TemperamentPicker";
import { requireUser } from "@/lib/auth";

/** An extra practice visit. The student chooses the patient's temperament and nothing else. */
export default async function PracticePage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl">
        <Link href="/student" className="text-[15px] text-brand-700 hover:underline">
          Back to your patients
        </Link>
        <h1 className="mt-2 text-[40px] font-semibold leading-tight text-slate-900">Practice patient</h1>
        <p className="mb-8 mt-1 text-slate-600">Choose how the patient behaves. Everything else is picked for you.</p>
        <TemperamentPicker />
      </div>
    </AppShell>
  );
}
