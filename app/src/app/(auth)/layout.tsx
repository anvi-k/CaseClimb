import type { ReactNode } from "react";
import { Logo } from "@/components/Brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-900 p-10 text-white lg:flex">
        <Logo large />
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Practice the visit before the visit.</h1>
          <p className="mt-4 max-w-md text-brand-100">
            Telehealth simulations with virtual patients: a live video-style visit on one side, the patient&apos;s chart on the other, and feedback you can trace back to what you actually said.
          </p>
        </div>
        <p className="text-xs text-brand-200">Synthetic patients for education only. Not for clinical use.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <Logo large />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
