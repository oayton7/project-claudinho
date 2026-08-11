import { MissingDatabaseConfig, STAGES, deleteProduct, updateProduct, type Stage } from "@/lib/db";

function fail(error: unknown) {
  if (error instanceof MissingDatabaseConfig) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[products/:id]", error);
  return Response.json(
    { error: error instanceof Error ? error.message : "Database error" },
    { status: 500 },
  );
}

/** PATCH /api/products/:id — move stage, record your verdict, log a kill reason */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.stage !== undefined) {
    if (!STAGES.includes(body.stage as Stage)) {
      return Response.json({ error: "Unknown stage" }, { status: 400 });
    }
    patch.stage = body.stage;
  }
  if (typeof body.my_verdict === "string") patch.my_verdict = body.my_verdict || null;
  if (typeof body.my_notes === "string") patch.my_notes = body.my_notes.slice(0, 20000);
  if (typeof body.killed_reason === "string") {
    patch.killed_reason = body.killed_reason.slice(0, 5000) || null;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    await updateProduct(id, patch);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE /api/products/:id — takes its judgements and pre-mortems with it */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await deleteProduct((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
