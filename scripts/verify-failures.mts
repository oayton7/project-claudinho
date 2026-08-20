/**
 * Does the tool fail loudly?
 *
 * Session 7 of the brief: one deliberate failure per external dependency, each
 * of which must produce a readable message rather than a crash or a shrug.
 *
 * This is the suite that matters most on this project. Almost every bug found
 * today was something that looked like it worked — a category key that
 * silently matched nothing, a request missing a parameter so ratings came back
 * as -1, an integer column rejecting decimals while the run reported success,
 * a rate limit marked as permanent failure. None of them announced themselves.
 *
 * So these tests do not check that things work. They check that when things
 * break, the message names the cause. The bar is: could someone read this and
 * know what to fix, without opening the code?
 *
 * No network and no spend — fetch is replaced for the duration.
 */
process.env.KEEPA_API_KEY ??= "test-key-not-real";

const { findProducts, findUsRisers, fetchProductRaw, KEEPA_DOMAIN, MissingKeepaKey } =
  await import("../src/lib/keepa.ts");
const { describeError } = await import("../src/lib/errors.ts");

let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Every message must survive this: would it tell you what to fix? */
function isUseful(message: string, mustMention: string[]): boolean {
  const lower = message.toLowerCase();
  const vague = ["something went wrong", "unknown error", "an error occurred", "failed"];
  const isVague = vague.some((v) => lower === v || lower === v + ".");
  return !isVague && mustMention.every((m) => lower.includes(m.toLowerCase()));
}

const realFetch = globalThis.fetch;
function stubFetch(response: Response | (() => Promise<never>)) {
  globalThis.fetch = (typeof response === "function"
    ? response
    : async () => response.clone()) as typeof fetch;
}
const restore = () => { globalThis.fetch = realFetch; };

async function messageFrom(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    return describeError(error);
  }
}

console.log("Keepa\n");

// A wrong key is the single most common setup mistake, and it cost an hour on
// this project when the message said nothing.
stubFetch(new Response("Invalid API key", { status: 401 }));
let message = await messageFrom(() => fetchProductRaw("B0TEST12345", KEEPA_DOMAIN.UK));
check("a bad key names the status", isUseful(message, ["401"]), message.slice(0, 90));

// Out of tokens is temporary and must read as temporary.
stubFetch(new Response(JSON.stringify({ tokensLeft: -12, refillRate: 20 }), { status: 429 }));
message = await messageFrom(() => findUsRisers({ minGrowth: 1.5 }));
check("a rate limit names the status", isUseful(message, ["429"]), message.slice(0, 90));

// Keepa returning HTML instead of JSON is what a proxy or an outage looks
// like, and it must not surface as a bare parser error.
stubFetch(new Response("<!DOCTYPE html><html>maintenance</html>", { status: 200 }));
message = await messageFrom(() =>
  findProducts({ categoryId: 123, limit: 5 }, KEEPA_DOMAIN.UK),
);
check(
  "malformed JSON blames Keepa, not the parser",
  isUseful(message, ["keepa"]),
  message.slice(0, 100),
);

// The network being gone is different from the API refusing, and should read
// differently.
stubFetch(async () => { throw new TypeError("fetch failed"); });
message = await messageFrom(() => fetchProductRaw("B0TEST12345", KEEPA_DOMAIN.UK));
check("a dead connection says so", message.toLowerCase().includes("fetch"), message.slice(0, 90));

restore();

// A missing key must tell you where to get one, not merely that it is absent.
const savedKey = process.env.KEEPA_API_KEY;
delete process.env.KEEPA_API_KEY;
message = await messageFrom(() => fetchProductRaw("B0TEST12345", KEEPA_DOMAIN.UK));
check(
  "a missing key says where to get one",
  isUseful(message, ["keepa.com"]),
  message.slice(0, 110),
);
check(
  "the typed error carries the guidance on its own",
  isUseful(new MissingKeepaKey().message, ["keepa_api_key", "keepa.com"]),
  new MissingKeepaKey().message.slice(0, 80),
);
process.env.KEEPA_API_KEY = savedKey;

console.log("\nThe rule these enforce\n");

// The generic message this project actually shipped once, and the hour it cost
// is the reason this suite exists.
check(
  "a bare Error is passed through, not replaced",
  describeError(new Error("401 invalid x-api-key")).includes("401"),
);
// These three all returned "Unknown error" before the suite existed, throwing
// away the only thing anyone knew about the failure.
check(
  "a thrown string survives intact",
  describeError("Keepa is down") === "Keepa is down",
  describeError("Keepa is down"),
);
check(
  "an object's message is dug out",
  describeError({ message: "connection reset" }) === "connection reset",
  describeError({ message: "connection reset" }),
);
check(
  "an unrecognised shape is shown, not binned",
  describeError({ weird: true }).includes("weird"),
  describeError({ weird: true }),
);
check(
  "an Error with no message names its type",
  describeError(new TypeError()).toLowerCase().includes("typeerror"),
  describeError(new TypeError()),
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nEvery failure names its own cause.");
