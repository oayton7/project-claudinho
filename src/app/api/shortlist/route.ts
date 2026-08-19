import { listShortlist } from "@/lib/db";
import { describeError } from "@/lib/claude";

/**
 * GET /api/shortlist?killed=1
 *
 * Everything the tool has decided, ranked. TEST first because those are the
 * ones to act on, then PARK — "why did you park this" is a question worth
 * being able to answer, and a parked product is often the one you come back to
 * when a supplier quote changes.
 */
export async function GET(request: Request) {
  const includeKilled = new URL(request.url).searchParams.get("killed") === "1";
  try {
    const rows = await listShortlist({ includeKilled });
    return Response.json({
      count: rows.length,
      test: rows.filter((r) => r.triage_verdict === "TEST").length,
      park: rows.filter((r) => r.triage_verdict === "PARK").length,
      killed: rows.filter((r) => r.triage_verdict === "KILL").length,
      rows,
    });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
