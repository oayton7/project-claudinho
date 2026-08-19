import { createRun, listRuns } from "@/lib/db";
import { describeError } from "@/lib/claude";

/**
 * POST /api/pipeline/start — queue a run and return immediately
 * GET  /api/pipeline/start — what runs exist and where they got to
 *
 * The page returns before any work happens, which is the whole point: a run
 * that takes twenty minutes cannot be something you wait for in a browser tab.
 */
export async function POST(request: Request) {
  try {
    const params = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const capPence = Number(params.capPence) > 0 ? Number(params.capPence) : 100;

    const run = await createRun(params, capPence);

    // Deliberately not started here. Kicking it from this request would put
    // the work back inside a request, which is what the job architecture
    // exists to avoid — and the two attempts at doing it over HTTP both died
    // silently. The run is queued; the watchdog picks it up, and /runs has a
    // button for starting it now.

    return Response.json({
      run: run.id,
      status: run.status,
      capPence,
      note: "Queued. Press Work the queue on /runs to start it now, or leave it for the watchdog.",
    });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}

export async function GET() {
  try {
    return Response.json({ runs: await listRuns() });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
