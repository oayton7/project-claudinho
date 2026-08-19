import { KEEPA_DOMAIN, searchCategories } from "@/lib/keepa";
import { cacheCategories, findCachedCategories, listCategoryPicks, setCategoryPick } from "@/lib/db";
import { describeError } from "@/lib/claude";

/**
 * GET  /api/keepa/categories?term=kitchen        — search, cache-first
 * GET  /api/keepa/categories?parentOf=11052591   — children of a category
 * GET  /api/keepa/categories?picks=1             — what is currently ticked
 * POST /api/keepa/categories                     — tick or untick one
 *
 * Cache first on purpose. Browsing the tree should cost nothing; only a term
 * the cache has never seen goes to Keepa, and what comes back is cached so it
 * is free next time.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const term = url.searchParams.get("term")?.trim() ?? "";
  const wantPicks = url.searchParams.get("picks");

  try {
    if (wantPicks) {
      return Response.json({ picks: await listCategoryPicks() });
    }

    if (!term) {
      return Response.json(
        { error: "Pass a term to search for, or picks=1." },
        { status: 400 },
      );
    }

    const cached = await findCachedCategories(term);
    if (cached.length > 0) {
      return Response.json({ source: "cache", categories: cached });
    }

    const fresh = await searchCategories(term, KEEPA_DOMAIN.UK);

    if (fresh.categories.length === 0) {
      return Response.json({
        source: "keepa",
        categories: [],
        note: `Keepa found no category matching "${term}". Try a broader word — the tree uses Amazon's own names, so "Storage" finds more than "Kitchen Storage Jars".`,
        tokensLeft: fresh.tokensLeft,
      });
    }

    await cacheCategories(fresh.categories);
    return Response.json({
      source: "keepa",
      categories: await findCachedCategories(term),
      tokensLeft: fresh.tokensLeft,
    });
  } catch (error) {
    // Never swallowed: the upstream message is the whole diagnostic value.
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      catId?: number;
      name?: string;
      picked?: boolean;
    };
    if (typeof body.catId !== "number") {
      return Response.json({ error: "catId must be a number" }, { status: 400 });
    }
    await setCategoryPick(body.catId, body.name ?? "", body.picked !== false);
    return Response.json({ picks: await listCategoryPicks() });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
