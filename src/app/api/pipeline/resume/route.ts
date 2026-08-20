/**
 * POST /api/pipeline/resume
 *
 * The manual counterpart to the watchdog. The watchdog only revives runs that
 * stopped for a reason known to be temporary; everything else waits for a
 * person to read the error, fix the cause, and say go again.
 *
 * Only resets the stage. The next tick does the work, so the same slice logic
 * and the same caps apply either way.
 */
import { resumeRun } from "@/lib/db";
import { describeError } from "@/lib/errors";

export const maxDuration = 30;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { runId?: string };
  if (!body.runId) {
    return Response.json({ error: "No run given to resume." }, { status: 400 });
  }

  try {
    const result = await resumeRun(body.runId);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
