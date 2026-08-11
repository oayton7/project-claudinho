import {
  MissingDatabaseConfig,
  listProducts,
  saveProduct,
  STAGES,
  type Stage,
} from "@/lib/db";
import { JudgementSchema, PremortemSchema, parseProductInput } from "@/lib/judge";

function fail(error: unknown) {
  if (error instanceof MissingDatabaseConfig) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[products]", error);
  return Response.json(
    { error: error instanceof Error ? error.message : "Database error" },
    { status: 500 },
  );
}

/** GET /api/products?stage=candidate */
export async function GET(request: Request) {
  try {
    const stage = new URL(request.url).searchParams.get("stage");
    if (stage && !STAGES.includes(stage as Stage)) {
      return Response.json({ error: "Unknown stage" }, { status: 400 });
    }
    return Response.json({ products: await listProducts((stage as Stage) ?? undefined) });
  } catch (error) {
    return fail(error);
  }
}

/** POST /api/products — save a judged product */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const product = parseProductInput(body.product);
  if (!product.ok) {
    return Response.json(
      { error: "Invalid product", details: product.errors },
      { status: 400 },
    );
  }

  // Re-validate the judgement rather than trusting what came back from the
  // browser. It originally came from us, but it has been to the client and
  // back, so it is untrusted input like anything else.
  const judgement = JudgementSchema.safeParse(body.judgement);
  if (!judgement.success) {
    return Response.json({ error: "Invalid judgement" }, { status: 400 });
  }

  const premortem = body.premortem
    ? PremortemSchema.safeParse(body.premortem)
    : null;
  if (premortem && !premortem.success) {
    return Response.json({ error: "Invalid pre-mortem" }, { status: 400 });
  }

  const yours = (body.yours ?? {}) as { verdict?: unknown; notes?: unknown };

  try {
    const { productId } = await saveProduct({
      product: product.value,
      judgement: judgement.data,
      premortem: premortem?.success ? premortem.data : null,
      marginInput: (body.marginInput as never) ?? null,
      myVerdict: typeof yours.verdict === "string" ? yours.verdict : "",
      myNotes: typeof yours.notes === "string" ? yours.notes.slice(0, 20000) : "",
      usage: (body.usage as never) ?? null,
    });
    return Response.json({ productId });
  } catch (error) {
    return fail(error);
  }
}
