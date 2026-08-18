import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, safeEqual, tokenFor } from "@/lib/gate";

/**
 * Runs before every request that matches the config below. If the gate cookie
 * is missing or wrong, you get the login page instead of the app.
 *
 * Note this protects the API routes as well as the pages. Guarding only the
 * pages would be theatre — anyone can POST to /api/judge directly, and that
 * one spends your API credit.
 */
export async function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD?.trim();

  // No password configured means the gate is off. Deliberate: it keeps local
  // development frictionless, and an empty SITE_PASSWORD in production is a
  // visible mistake rather than a silent lockout.
  if (!password) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const expected = await tokenFor(password);

  if (cookie && safeEqual(cookie, expected)) return NextResponse.next();

  // API calls get an honest 401 rather than a redirect to an HTML page, which
  // would otherwise arrive at the client as an unparseable JSON error.
  //
  // Except when a person typed the URL into a browser. A raw 401 blob is a
  // dead end that reads as "the link is broken", so a navigation gets sent to
  // the login page like any other page would be. Only real fetch calls, which
  // do not ask for HTML, still get the 401 their code can handle.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const wantsHtml = request.headers.get("accept")?.includes("text/html");
    if (!wantsHtml) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login route itself, Next's internals, and static
  // files. Without the exclusions the login page would redirect to itself.
  matcher: ["/((?!login|api/login|api/health|_next/static|_next/image|favicon.ico).*)"],
};
