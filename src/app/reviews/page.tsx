"use client";

import { useState } from "react";
import Link from "next/link";

type Analysis = {
  complaints: string[];
  wishedFor: string[];
  fixable: string[];
  notFixable: string[];
  opportunityScore: number;
  summary: string;
};

/**
 * The collector.
 *
 * Amazon blocks servers reading reviews, but not a browser reading a page it
 * is already on. This runs in Oscar's own tab, pulls the review text out of
 * the DOM and puts it on the clipboard. No scraping infrastructure, no proxy
 * subscription, no credentials anywhere.
 *
 * Written as one line because a bookmarklet has to be.
 */
/**
 * The collector, with a judgement built in.
 *
 * Three-star reviews are the richest seam: one-star is mostly delivery
 * failures and wrong items, five-star says "great, thanks", and three-star is
 * someone who wanted to like it, used it, and was let down by something
 * specific.
 *
 * But a product can have almost none. The camping chair had three, because its
 * failure is catastrophic rather than marginal — the chair breaks, so nobody
 * lands in the middle. Insisting on three-star only would have found nothing
 * on the clearest signal we have seen.
 *
 * So it widens rather than settles: three-star first, and only if that is too
 * thin to read does it add two-star, then one-star. Which filters it used is
 * recorded, because "12 reviews, all one-star" and "12 reviews, all three-star"
 * are different evidence and the analysis is told which it is looking at.
 */
const ENOUGH_REVIEWS = 12;

const BOOKMARKLET = `javascript:(async function(){
var m=location.href.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/);
if(!m){alert('Open the Amazon product page or its reviews page first.');return;}
var asin=m[1],all=[],seen={},used=[],ENOUGH=${ENOUGH_REVIEWS};
async function grab(star,label){
 var got=0;
 for(var p=1;p<=8;p++){
  var u='/product-reviews/'+asin+'/?filterByStar='+star+'&reviewerType=all_reviews&pageNumber='+p;
  var r;try{r=await fetch(u,{credentials:'include'});}catch(e){break;}
  if(!r.ok)break;
  var h=await r.text();
  if(/ap\\/signin/.test(h.slice(0,5000))){alert('Amazon wants you signed in. Sign in to amazon.co.uk in this browser, then click again.');throw 0;}
  var d=new DOMParser().parseFromString(h,'text/html');
  var rs=d.querySelectorAll('[data-hook="review"]');
  if(!rs.length)break;
  var before=all.length;
  rs.forEach(function(x){
   var id=x.getAttribute('id')||'';if(seen[id])return;seen[id]=1;
   var st=x.querySelector('[data-hook="review-star-rating"],[data-hook="cmps-review-star-rating"]');
   var t=x.querySelector('[data-hook="review-title"]');
   var b=x.querySelector('[data-hook="review-body"]');
   var body=b?b.textContent.trim().replace(/\\s+/g,' '):'';
   if(!body)return;
   all.push((st?st.textContent.trim()[0]:'?')+'★ '+(t?t.textContent.trim().split('\\n').pop().trim():'')+' — '+body);
   got++;
  });
  if(all.length===before)break;
 }
 if(got)used.push(label+' ('+got+')');
}
try{
 await grab('three_star','3 star');
 if(all.length<ENOUGH)await grab('two_star','2 star');
 if(all.length<ENOUGH)await grab('one_star','1 star');
}catch(e){return;}
if(!all.length){alert('No critical review text found for '+asin+'.');return;}
var out='ASIN: '+asin+'\\nStars: '+used.join(', ')+'\\nReviews: '+all.length+'\\n\\n'+all.join('\\n\\n---\\n\\n');
try{await navigator.clipboard.writeText(out);alert('Copied '+all.length+' reviews for '+asin+'.\\nPulled: '+used.join(', ')+'\\n\\nPaste into Project Claudinho.');}
catch(e){var w=window.open('','_blank');w.document.write('<pre>'+out.replace(/</g,'&lt;')+'</pre>');}
})();`;

export default function ReviewsPage() {
  const [asin, setAsin] = useState("");
  const [productName, setProductName] = useState("");
  const [starFilter, setStarFilter] = useState("3 star");
  const [rawText, setRawText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function analyse() {
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin,
          productName,
          starFilter,
          rawText,
          reviewCount: rawText.split("---").length,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not analyse those reviews.");
        return;
      }
      setAnalysis(data.analysis);
      setCost(data.cost?.costPence ?? null);
      if (data.savedWarning) setError(data.savedWarning);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const list = (items: string[], tone: string) => (
    <ul className="mt-1 space-y-1">
      {items.map((item) => (
        <li key={item} className={`text-sm leading-6 ${tone}`}>
          {item}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl flex-1 px-6 py-14 sm:px-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← Project Claudinho
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Reviews
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          A rating of 3.9 tells you people are unhappy. Only the words tell you
          what about, and whether it is something you could fix. This sorts
          complaints into the ones a better supplier brief would solve and the
          ones inherent to the product, because only the first kind is an
          opening.
        </p>

        <div className="mt-6 rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-black dark:text-zinc-100">
            Getting the reviews out of Amazon
          </h2>
          <p className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <strong className="font-medium">Why three stars.</strong> One-star
            reviews are mostly delivery failures and wrong items, and five-star
            reviews say &quot;great, thanks&quot;. Three stars is someone who
            wanted to like it, used it, and was let down by something specific.
            That specific thing is what you would fix.
            <br />
            <br />
            <strong className="font-medium">And why it widens.</strong> A
            product whose failure is catastrophic rather than marginal has
            almost no three-star reviews — nobody lands in the middle on a chair
            that snaps. The first real test of this had three. Insisting on
            three-star only would have found nothing on the clearest signal we
            have seen.
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Amazon blocks servers from reading reviews and asks a logged-out
            visitor to sign in, so the app cannot fetch them. Your own browser,
            already signed in, is a different matter. Drag this to your
            bookmarks bar once:
          </p>
          <a
            href={BOOKMARKLET}
            onClick={(e) => e.preventDefault()}
            className="mt-3 inline-block cursor-grab rounded border border-zinc-400 bg-zinc-100 px-4 py-2 text-sm font-medium text-black dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          >
            Grab reviews
          </a>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(BOOKMARKLET);
              setCopied(true);
            }}
            className="ml-3 text-xs text-zinc-500 underline"
          >
            {copied ? "Copied — make a bookmark and paste this as the URL" : "Or copy the code"}
          </button>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
            <li>
              Make sure you are signed in to amazon.co.uk in this browser. The
              reviews are gated behind it
            </li>
            <li>
              Open the product page. Any page with the ASIN in the URL will do —
              you do not need to click through to the reviews
            </li>
            <li>
              Click the bookmarklet. It starts at{" "}
              <strong className="font-medium">three stars</strong>, and only if
              there are too few to read anything into does it widen to two, then
              one. It records which it used
            </li>
            <li>Paste below. The ASIN fills itself in</li>
          </ol>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              ASIN
            </span>
            <input
              value={asin}
              onChange={(e) => setAsin(e.target.value.toUpperCase())}
              placeholder="B0FDS8Q4XJ"
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Product name
            </span>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Which stars
            </span>
            <input
              value={starFilter}
              onChange={(e) => setStarFilter(e.target.value)}
              placeholder="3 star"
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
        </div>

        <textarea
          value={rawText}
          onChange={(e) => {
            const text = e.target.value;
            setRawText(text);
            // The bookmarklet writes a header, so the ASIN and star filter fill
            // themselves in. One less thing to retype, and one less way to
            // save reviews against the wrong product.
            const found = text.match(/^ASIN:\s*([A-Z0-9]{10})/m);
            if (found && !asin) setAsin(found[1]);
            const stars = text.match(/^Stars:\s*(.+)$/m);
            if (stars) setStarFilter(stars[1].trim());
          }}
          rows={10}
          placeholder="Paste the reviews here — this is the box the bookmarklet fills your clipboard for…"
          className="mt-4 w-full rounded border border-zinc-300 bg-white p-3 font-mono text-xs text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void analyse()}
            disabled={loading || rawText.trim().length < 200}
            className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-black"
          >
            {loading ? "Reading…" : "Read the reviews (about 1p)"}
          </button>
          <span className="text-xs text-zinc-500">
            {rawText.trim().length.toLocaleString("en-GB")} characters pasted
          </span>
          {cost !== null && (
            <span className="ml-auto font-mono text-xs text-zinc-500">
              cost {cost}p
            </span>
          )}
        </div>

        {error && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {analysis && (
          <div className="mt-8 space-y-6">
            <div className="rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-black dark:text-zinc-100">
                  Opportunity
                </h2>
                <span className="text-2xl font-semibold tabular-nums text-black dark:text-zinc-100">
                  {analysis.opportunityScore}/10
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                {analysis.summary}
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-emerald-800 dark:text-emerald-400">
                  You could fix these
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Supplier-brief problems. This is the opening.
                </p>
                {list(analysis.fixable, "text-emerald-800 dark:text-emerald-400")}
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  You could not
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Inherent to the product. A long list here is a warning.
                </p>
                {list(analysis.notFixable, "text-zinc-600 dark:text-zinc-400")}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-black dark:text-zinc-100">
                  What they complain about
                </h3>
                {list(analysis.complaints, "text-zinc-700 dark:text-zinc-300")}
              </div>
              <div>
                <h3 className="text-sm font-medium text-black dark:text-zinc-100">
                  What they wish it had
                </h3>
                {list(analysis.wishedFor, "text-zinc-700 dark:text-zinc-300")}
              </div>
            </div>

            <p className="text-xs leading-5 text-zinc-500">
              Saved against {asin}, raw text included, so this can be re-read
              later against a better prompt without going back to Amazon.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
