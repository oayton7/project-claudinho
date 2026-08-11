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
