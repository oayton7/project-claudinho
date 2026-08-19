/**
 * The pipeline stages and row shapes, split out from db.ts so that pages and
 * components can import them.
 *
 * db.ts holds the service-role key and must never be imported from client
 * code. Next.js only inlines NEXT_PUBLIC_* variables into the browser bundle,
 * so the key would not actually leak — but relying on that is one refactor
 * away from a real leak, and the rule in CLAUDE.md is the simpler thing to
 * follow: client code never imports the module that touches the database.
 */
import type { MarginInput } from "./margin";

export const STAGES = [
  "candidate",
  "qualified",
  "sampling",
  "dropship_test",
  "ordered",
  "live",
  "dead",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  candidate: "Candidate",
  qualified: "Qualified",
  sampling: "Sampling",
  dropship_test: "Dropship test",
  ordered: "Ordered",
  live: "Live",
  dead: "Dead",
};

export type ProductRow = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  asin: string | null;
  category: string;
  stage: Stage;
  sell_price: number;
  weight_grams: number;
  listing_notes: string;
  review_complaints: string;
  competitor_notes: string;
  us_signal: string;
  my_verdict: string | null;
  my_notes: string;
  margin_input: MarginInput | null;
  killed_reason: string | null;
  /** Present on list queries via the join in listProducts. */
  judgements?: { verdict: string; summary: string; created_at: string }[];
};


/**
 * Re-exported for pages. Client components must not import db.ts, because that
 * would pull the service-role key into the browser bundle.
 */
export type ScoutCandidateRow = {
  asin: string;
  first_seen: string;
  last_seen: string;
  title: string;
  brand: string;
  category: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  unhappy_buyers: number | null;
  monthly_sold: number | null;
  sellers: number | null;
  weight_grams: number | null;
  max_landed_cost: number | null;
  score: number | null;
  coverage: number | null;
  strengths: string;
  listing_weaknesses: string;
  killed_reason: string | null;
  us_growing: boolean | null;
  us_monthly_sold: number | null;
  auto_verdict: "TEST" | "PARK" | "KILL" | null;
  auto_because: string;
  triage_verdict: "TEST" | "PARK" | "KILL" | null;
  triage_because: string | null;
  triage_improvability: number | null;
  triage_main_risk: string | null;
  triage_at: string | null;
  us_avg365_rank: number | null;
  us_current_rank: number | null;
  us_growth_ratio: number | null;
  found_via: string | null;
  has_aplus: boolean | null;
  video_count: number | null;
  parent_asin: string | null;
  judge_verdict: string | null;
  judge_summary: string | null;
  judge_json: {
    targetBuyer?: { who?: string; score?: number; reasoning?: string };
    improvability?: Record<string, { score?: number; reasoning?: string }>;
    marketability?: Record<string, { score?: number; reasoning?: string }>;
    specificFix?: string;
    whyHasntSomeoneFixedIt?: string;
    concerns?: string[];
    verdict?: string;
    summary?: string;
  } | null;
  judge_pence: number | null;
  judge_at: string | null;
  judge_missing: string | null;
  dismissed: boolean;
  my_notes: string;
  promoted_product_id: string | null;
};
