import type { CaseProfile } from "@/lib/types";
import type { SectionId } from "@/lib/studio/profile";

export type Setter = (fn: (p: CaseProfile) => CaseProfile) => void;
export interface SectionProps {
  p: CaseProfile;
  set: Setter;
  go: (section: SectionId) => void;
}
