import { COOKIE_NAME, safeEqual, tokenFor } from "@/lib/gate";

/**
 * POST /api/login
 *
 * Checks the submitted password against SITE_PASSWORD and, if it matches,
 * sets the gate cookie. The password is never stored anywhere and never
 * logged — the cookie holds a hash of it.
 */
export async function POST(request: Request) {
  // Trimmed: an env var pasted into a dashboard very often carries a
  // trailing space or newline, and nobody means their password to include one.
  const configured = process.env.SITE_PASSWORD?.trim();
  if (!configured) {
    return Response.json({ error: "No site password is set" }, { status: 503 });
  }

  let submitted = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    submitted = typeof body.password === "string" ? body.password.trim() : "";
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  // Compare hashes rather than the raw strings so the check is constant-time
  // over a fixed length regardless of what was submitted.
  const ok = safeEqual(await tokenFor(submitted), await tokenFor(configured));
  if (!ok) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    [
      `${COOKIE_NAME}=${await tokenFor(configured)}`,
      "Path=/",
      "HttpOnly", // JavaScript cannot read it, so an XSS bug cannot steal it
      "SameSite=Lax",
      "Secure", // HTTPS only. Ignored on localhost, which browsers treat as secure
      `Max-Age=${60 * 60 * 24 * 30}`,
    ].join("; "),
  );
  return response;
}
