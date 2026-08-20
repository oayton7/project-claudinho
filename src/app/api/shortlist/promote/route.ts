import { promoteCandidate } from "@/lib/db";
import { describeError } from "@/lib/claude";

/**
 * POST /api/shortlist/promote  { asin }
 *
 * Moves a candidate onto the products board, carrying everything the Scout
 * already knows so nothing is retyped. The link back to the candidate is what
 * stops it resurfacing as new on the next sweep.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { asin?: string };
    const asin = (body.asin ?? "").toUpperCase().trim();

    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return Response.json({ error: "Pass a 10-character ASIN." }, { status: 400 });
    }

    const result = await promoteCandidate(asin);
    return Response.json({
      ...result,
      note: result.alreadyPromoted
        ? "Already on the products board — this did not create a second one."
        : "On the products board. It will not come back as a fresh candidate.",
    });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
