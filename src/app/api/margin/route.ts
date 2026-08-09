import { calculateMargin, parseMarginInput } from "@/lib/margin";

/**
 * POST /api/margin
 *
 * Runs on the server, never in the browser. Right now the maths is harmless
 * arithmetic that could live in the browser quite happily, but the rubric
 * thresholds are the actual IP and from Phase 3 this route will hold an API
 * key. Both are reasons the calculation belongs on this side of the wire.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = parseMarginInput(body);

  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid input", details: parsed.errors },
      { status: 400 },
    );
  }

  return Response.json(calculateMargin(parsed.value));
}
