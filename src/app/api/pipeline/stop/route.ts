/**
 * POST /api/pipeline/stop  { runId }
 *
 * Stops a run now.
 *
 * There was no way to do this, which only became obvious when a run started
 * spending on work that had deliberately been deferred. Waiting for a spend
 * cap to bite is not a stop button: the cap is a ceiling on damage, not a
 * control.
 *
 * Halts rather than fails, so nothing already paid for is lost and Resume
 * picks it up from its cursors if it turns out to be wanted after all.
 */
import { getRun, updateRun } from "@/lib/db";
import { describeError } from "@/lib/errors";

export const maxDuration = 30;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { runId?: string };
  if (!body.runId) {
    return Response.json({ error: "No run given to stop." }, { status: 400 });
  }

  try {
    const run = await getRun(body.runId);
    if (!run) return Response.json({ error: "That run no longer exists." }, { status: 404 });

    if (["done", "failed", "halted"].includes(run.status)) {
      return Response.json({ ok: true, status: run.status, note: "Already stopped." });
    }

    await updateRun(body.runId, {
      status: "halted",
      stage_detail: `stopped by hand after ${Number(run.spent_pence).toFixed(2)}p`,
    });
    return Response.json({
      ok: true,
      status: "halted",
      spentPence: Number(run.spent_pence),
      note: "Stopped. Nothing already paid for is lost, and Resume will carry on from here.",
    });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
