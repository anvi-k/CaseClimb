import { apiUser } from "@/lib/auth";
import { longJson } from "@/lib/http";
import { proposeStages } from "@/lib/journey/guide";

/** The AI guide proposes encounters for a case. Body: { caseId, brief? } */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  return longJson(() => proposeStages(String(b.caseId || ""), String(b.brief || "").slice(0, 1000)));
}
