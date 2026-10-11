import { apiUser } from "@/lib/auth";
import { markerSummary } from "@/lib/markersData";
import { syntheaSummary } from "@/lib/syntheaData";

/** The data sources a new patient can be grounded in: health-markers rows by condition, and Synthea records. */
export async function GET() {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  return Response.json({ ...markerSummary(), synthea: syntheaSummary() });
}
