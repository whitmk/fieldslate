"use client";

// The page after Stripe (approved mockup: docs/mockups/add-season.html,
// screen 5). Reads the season_purchases row every 2 seconds until it reaches
// an end state; purchasePageState decides the state and purchasePageCopy
// words it. The clock is read only in effects, never while rendering.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  CONTACT_EMAIL,
  purchasePageCopy,
  purchasePageState,
  signupWaitStep,
  type PurchasePageState,
  type PurchaseRow,
} from "@/lib/billing/season-purchase";

const POLL_MS = 2000;
const END_STATES: PurchasePageState[] = ["ready", "upgraded", "flagged", "abandoned"];

export function PurchaseStatus({ purchaseId }: { purchaseId: string }) {
  const { state, row } = usePurchasePoll(purchaseId);
  return <PurchaseStatusView state={state} row={row} />;
}

/**
 * The new-season flow's wait for a paid signup (awaitingSignupPurchaseId):
 * the purchase page's poll and views, worded for a signup. When the webhook
 * lands (or the checkout turns out abandoned) it reloads the server state, and
 * the flow then shows the form that state calls for — with the credit.
 */
export function SignupPaymentWait({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const { state, row } = usePurchasePoll(purchaseId);
  const step = signupWaitStep(state);
  useEffect(() => {
    if (step === "reload") router.refresh();
  }, [step, router]);
  return <PurchaseStatusView state={step === "reload" ? "waiting" : state} row={row} />;
}

/** Reads the purchase row every POLL_MS until it reaches an end state. */
function usePurchasePoll(purchaseId: string): { state: PurchasePageState; row: PurchaseRow | null } {
  const [row, setRow] = useState<PurchaseRow | null>(null);
  const [state, setState] = useState<PurchasePageState>("waiting");
  const started = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    started.current = Date.now();
    const supabase = createClient();

    async function tick() {
      const { data, error } = await supabase
        .from("season_purchases" as never)
        .select("id, kind, tier, status, needs_review, league_id, name, start_date, end_date")
        .eq("id", purchaseId)
        .maybeSingle();
      if (stopped) return;
      const next = error ? null : ((data as PurchaseRow | null) ?? null);
      const s = purchasePageState(next, Date.now() - (started.current ?? Date.now()));
      setRow(next);
      setState(s);
      if (!END_STATES.includes(s) && s !== "unreadable") {
        timer = setTimeout(tick, POLL_MS);
      }
    }
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [purchaseId]);

  return { state, row };
}

/** Pure render of one state — the scratch check renders every state with it. */
export function PurchaseStatusView({
  state,
  row,
}: {
  state: PurchasePageState;
  row: PurchaseRow | null;
}) {
  const copy = purchasePageCopy(state, row);
  const icon =
    state === "ready" || state === "upgraded" ? (
      <span className="mx-auto mb-4 grid place-items-center rounded-full bg-[#22C55E]/15 p-3.5 text-[#16a34a]">
        <Check className="h-6 w-6" strokeWidth={3} />
      </span>
    ) : state === "flagged" || state === "unreadable" ? (
      <span className="mx-auto mb-4 grid place-items-center rounded-full bg-orange-100 p-3.5 text-orange-800">
        <AlertCircle className="h-6 w-6" />
      </span>
    ) : state === "abandoned" ? null : (
      <span className="mx-auto mb-4 grid place-items-center rounded-full bg-gray-100 p-3.5 text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </span>
    );

  return (
    <div className="flex justify-center px-0 py-6 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white px-6 py-7 text-center shadow-sm">
        {icon && <div className="flex justify-center">{icon}</div>}
        <h1 className="text-lg font-bold text-[#0C1F3F]">{copy.title}</h1>
        {copy.meta && <p className="mt-1 text-sm font-semibold text-[#0C1F3F]">{copy.meta}</p>}
        {copy.lines.map((l) => (
          <p key={l} className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
            {l}
          </p>
        ))}

        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          {state === "ready" && row?.league_id ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Back to Overview
              </Link>
              <Link
                href={`/dashboard/leagues/${row.league_id}`}
                className="rounded-lg bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a]"
              >
                Open {row.name ?? "season"}
              </Link>
            </>
          ) : state === "waiting" ? null : state === "slow" ? (
            <Link
              href="/dashboard/leagues"
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Go to Seasons
            </Link>
          ) : (
            <Link
              href={state === "abandoned" ? "/dashboard/leagues" : "/dashboard"}
              className="rounded-lg bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a]"
            >
              {state === "abandoned" ? "Back to Seasons" : "Back to Overview"}
            </Link>
          )}
        </div>

        {(state === "flagged" || state === "slow" || state === "unreadable") && (
          <p className="mt-4 text-xs text-gray-400">
            Questions?{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[#16a34a] underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
