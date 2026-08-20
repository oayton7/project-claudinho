/**
 * POST /api/judge/candidate  { asin }
 *
 * The deep look, on one product, on demand.
 *
 * Triage answers "is this worth an expensive opinion" in a sentence, which is
 * the right shape for fifteen products at a time. This is what you press when
 * the sentence is not enough: the target buyer, what specifically is being
 * done badly and what you would do instead, why nobody has already fixed it,
 * and what would sink it.
 *
 * Costs roughly 9-11p and takes over a minute. The pipeline now runs the same
 * judgement as a stage; this stays for judging one product out of turn.
 */
import { judgeOne } from "@/lib/deep-judge";
import { describeError } from "@/lib/errors";

export const maxDuration = 300;

export async function POST(request: Request) {
  let asin = "";
  try {
    const body = (await request.json()) as { asin?: string };
    asin = (body.asin ?? "").toUpperCase().trim();
  } catch {
    return Response.json({ error: "Body must be JSON with an asin" }, { status: 400 });
  }

  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return Response.json({ error: "Pass a 10-character ASIN." }, { status: 400 });
  }

  try {
    return Response.json(await judgeOne(asin));
  } catch (error) {
    console.error("[judge/candidate]", error);
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
