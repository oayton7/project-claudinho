/**
 * POST /api/niche  { categoryId } or { asins: [...] }  — is there room here
 *
 * Every other paid call in this tool judges one product. This one judges the
 * shelf: whether there is space on it, and what specifically to put there.
 *
 * Free arithmetic first and always. readNiche() works out concentration,
 * satisfaction and how hard the field is trying from the listings alone, and
 * a category that is plainly owned and well executed can be answered without
 * spending anything. Only a field worth arguing about reaches the Judge, and
 * then it is one call for the whole category rather than one per product,
 * which is a tenth of the cost of judging the field product by product.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  NICHE_SYSTEM_PROMPT,
  NicheVerdictSchema,
  buildNichePrompt,
} from "@/lib/judge";
import { MODEL, guarded, priceIt } from "@/lib/claude";
import { readNiche, type Competitor } from "@/lib/niche";
import { fetchProductRaw, KEEPA_DOMAIN, findProducts } from "@/lib/keepa";
import { buildCandidate } from "@/lib/candidate";
import { isMedia } from "@/lib/exclusions";
import { recordApiSpend, getReviews } from "@/lib/db";
import { describeError } from "@/lib/errors";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    categoryId?: number;
    asins?: string[];
    niche?: string;
    /** Skip the paid opinion and return the arithmetic alone. */
    arithmeticOnly?: boolean;
  };

  try {
    // Gather the field. Either a category, or a list of ASINs you already
    // believe are the competition.
    let asins: string[] = [];
    if (Array.isArray(body.asins) && body.asins.length > 0) {
      asins = body.asins
        .map((a) => String(a).toUpperCase().trim())
        .filter((a) => /^[A-Z0-9]{10}$/.test(a))
        .slice(0, 20);
    } else if (body.categoryId) {
      const found = await findProducts(
        {
          categoryId: body.categoryId,
          minPrice: 8,
          maxPrice: 120,
          limit: 20,
        },
        KEEPA_DOMAIN.UK,
      );
      asins = found.asins.slice(0, 20);
    }

    if (asins.length < 4) {
      return Response.json(
        {
          error:
            "Need at least four competing products to read a category. Give a categoryId, or a list of ASINs you believe are the field.",
        },
        { status: 400 },
      );
    }

    const raw = await fetchProductRaw(asins.join(","), KEEPA_DOMAIN.UK, {
      history: false,
      stats: 0,
    });
    const products = ((raw.raw as Record<string, unknown>).products ?? []) as Record<
      string,
      unknown
    >[];

    const competitors: Competitor[] = products
      .filter((p) => !isMedia(p))
      .map((p) => {
        const c = buildCandidate(p, body.niche ?? "");
        return {
          asin: c.asin,
          title: c.title,
          brand: c.brand,
          price: c.price,
          rating: c.rating,
          reviewCount: c.reviewCount,
          hasAplus: c.hasAplus,
          videoCount: c.videoCount,
          imageCount: c.imageCount ?? null,
          weaknesses: c.listingWeaknesses,
        } as Competitor & { weaknesses: string[] };
      });

    const picture = readNiche(competitors);
    if (!picture) {
      return Response.json(
        { error: "Too few usable listings came back to read this category." },
        { status: 422 },
      );
    }

    // A category that is plainly owned and well served is answered for free.
    if (body.arithmeticOnly || picture.room === "crowded") {
      return Response.json({
        picture,
        competitors: competitors.length,
        verdict: null,
        note:
          picture.room === "crowded"
            ? "Answered without spending anything: this shelf has an owner and the field executes well. The paid opinion is available if you disagree, but the arithmetic is not close."
            : "Arithmetic only, as asked.",
      });
    }

    // Any buyer complaints already collected for this field, which are worth
    // more than anything the model can infer from a listing.
    const complaints = (
      await Promise.all(
        competitors.slice(0, 6).map(async (c) => {
          const r = await getReviews(c.asin).catch(() => null);
          return r?.complaints ? `${c.brand ?? c.asin}: ${r.complaints}` : null;
        }),
      )
    )
      .filter(Boolean)
      .join("\n");

    const result = await guarded((client) =>
      client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: zodOutputFormat(NicheVerdictSchema) },
        system: NICHE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildNichePrompt({
              niche: body.niche ?? `category ${body.categoryId ?? "(by ASIN list)"}`,
              picture: picture as unknown as Record<string, unknown>,
              competitors: competitors as never,
              complaints: complaints || null,
            }),
          },
        ],
      }),
    );

    const text = result.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = NicheVerdictSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return Response.json(
        {
          error: `The category assessment came back in the wrong shape — ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}.`,
          picture,
        },
        { status: 502 },
      );
    }

    const cost = priceIt(result.usage);
    await recordApiSpend("judge", cost.costPence);

    return Response.json({
      picture,
      competitors: competitors.length,
      readReviews: Boolean(complaints),
      verdict: parsed.data,
      cost,
    });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
