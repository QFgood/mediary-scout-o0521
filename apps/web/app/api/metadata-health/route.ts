import { connection } from "next/server";
import { getCurrentAccountId } from "../../../lib/workflow-runtime";
import { getMetadataHealth } from "../../../lib/metadata-health";
export async function GET() {
  await connection();
  const services = await getMetadataHealth(await getCurrentAccountId());
  return Response.json({ services }, { headers: { "Cache-Control": "no-store" } });
}
