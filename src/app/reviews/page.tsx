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
const BOOKMARKLET = `javascript:(async function(){
var m=location.href.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/);
if(!m){alert('Open the Amazon product page or its reviews page first.');return;}
var asin=m[1],all=[],seen={},pages=0;
for(var p=1;p<=12;p++){
 var u='/product-reviews/'+asin+'/?filterByStar=three_star&reviewerType=all_reviews&pageNumber='+p;
 var r;try{r=await fetch(u,{credentials:'include'});}catch(e){break;}
 if(!r.ok)break;
 var d=new DOMParser().parseFromString(await r.text(),'text/html');
 if(d.querySelector('form[name=signIn]')||/ap\\/signin/.test(d.documentElement.innerHTML.slice(0,4000))){
  alert('Amazon is asking you to sign in. Sign in to amazon.co.uk in this browser, then click again.');return;}
 var rs=d.querySelectorAll('[data-hook="review"]');
 if(!rs.length)break;
 pages++;
 var before=all.length;
 rs.forEach(function(x){
  var id=x.getAttribute('id')||'';
  if(seen[id])return;seen[id]=1;
  var st=x.querySelector('[data-hook="review-star-rating"],[data-hook="cmps-review-star-rating"]');
  var t=x.querySelector('[data-hook="review-title"]');
  var b=x.querySelector('[data-hook="review-body"]');
  var body=b?b.textContent.trim():'';
  if(!body)return;
  all.push((st?st.textContent.trim().split('\\n')[0]:'')+' | '+(t?t.textContent.trim().split('\\n').pop().trim():'')+'\\n'+body);
 });
 if(all.length===before)break;
}
if(!all.length){alert('No three-star review text found. Either there are none, or Amazon wants you signed in.');return;}
var out='ASIN: '+asin+'\\nStars: 3\\nReviews: '+all.length+' across '+pages+' page(s)\\n\\n'+all.join('\\n\\n---\\n\\n');
try{await navigator.clipboard.writeText(out);alert('Copied '+all.length+' three-star reviews for '+asin+'.\\n\\nPaste into Project Claudinho.');}
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
              Click the bookmarklet. It filters to{" "}
              <strong className="font-medium">three stars</strong> itself, walks
              every page of them, and copies the lot
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
            <select
              value={starFilter}
              onChange={(e) => setStarFilter(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option>3 star</option>
              <option>2 star</option>
              <option>1 star</option>
              <option>4 star</option>
              <option>all</option>
            </select>
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
            const stars = text.match(/^Stars:\s*(\d)/m);
            if (stars) setStarFilter(`${stars[1]} star`);
          }}
          rows={10}
          placeholder="Paste the reviews here…"
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
