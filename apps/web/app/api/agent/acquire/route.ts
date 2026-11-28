import { connection, NextResponse, type NextRequest } from "next/server";
import { agentApiGuard } from "../../../../lib/agent-api/guard";
import { acquireMedia, type AcquireInput } from "../../../../lib/agent-api/acquire";
import { assertNotDemoFromEnv } from "../../../../lib/demo-mode";
import { getOwnerAccountId } from "../../../../lib/agent-api/owner";

export async function POST(request: NextRequest) {
  await connection();
  const denied = await agentApiGuard(request);
  if (denied) {
    return denied;
  }
  try {
    assertNotDemoFromEnv(process.env);
  } catch {
    return NextResponse.json({ error: "demo 模式禁止写操作" }, { status: 403 });
  }

  let body: AcquireInput;
  try {
    body = (await request.json()) as AcquireInput;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    (body.query != null && typeof body.query !== "string") ||
    (body.tmdbId != null && (!Number.isSafeInteger(body.tmdbId) || body.tmdbId < 1)) ||
    (body.anilistId != null && (!Number.isSafeInteger(body.anilistId) || body.anilistId < 1 || body.anilistId > 2_147_483_647)) ||
    (body.type != null && body.type !== "movie" && body.type !== "tv") ||
    (body.season != null && (!Number.isSafeInteger(body.season) || body.season < 0)) ||
    (body.storageId != null && typeof body.storageId !== "string") ||
    (body.reserve != null && typeof body.reserve !== "boolean") ||
    (body.anilistId != null && (body.tmdbId != null || body.query?.trim() || body.season != null || body.type != null)) ||
    (body.reserve && body.anilistId == null) ||
    (!body.query?.trim() && body.tmdbId == null && body.anilistId == null)) {
    return NextResponse.json({ error: "请提供有效的 query、tmdbId 或 anilistId；AniList 作品需单独指定" }, { status: 400 });
  }

  const accountId = await getOwnerAccountId();
  const result = await acquireMedia(body, accountId);

  if (result.status === "ambiguous") {
    return NextResponse.json(result, { status: 409 });
  }
  if (result.status === "not_found") {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
