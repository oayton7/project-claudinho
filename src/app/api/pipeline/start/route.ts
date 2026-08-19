import { after } from "next/server";
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

    // Kick the first tick after this response is sent. An un-awaited fetch
    // would be killed the moment the function returns, which is how the first
    // version queued runs that never started.
    after(async () => {
      try {
        await fetch(new URL("/api/pipeline/tick", request.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: request.headers.get("cookie") ?? "",
          },
          body: JSON.stringify({ runId: run.id }),
        });
      } catch {
        // The watchdog picks up anything that never started.
      }
    });

    return Response.json({
      run: run.id,
      status: run.status,
      capPence,
      note: "Queued. It walks itself forward from here — close the tab if you like.",
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
