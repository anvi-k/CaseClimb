import { apiUser } from "@/lib/auth";
import { markerSummary } from "@/lib/markersData";

/** Whether the health-markers dataset is installed, and how many usable rows each condition has. */
export async function GET() {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  return Response.json(markerSummary());
}
