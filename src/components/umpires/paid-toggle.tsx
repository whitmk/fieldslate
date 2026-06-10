"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** Pill toggle for game_umpires.paid — calls the toggle_assignment_paid RPC
 *  (migration 0062; org membership enforced inside the function). */
export function PaidToggle({
  assignmentId,
  paid,
}: {
  assignmentId: string;
  paid: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    setBusy(true);
    setError(false);
    const supabase = createClient();
    // RPC isn't in the generated Functions types (kept empty — adding entries
    // changes rpc() inference for the existing as-never call sites).
    const { error: rpcError } = await supabase.rpc(
      "toggle_assignment_paid" as never,
      { p_assignment_id: assignmentId } as never,
    );
    setBusy(false);
    if (rpcError) {
      setError(true);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={
        error
          ? "Couldn't update — try again"
          : paid
            ? "Mark as unpaid"
            : "Mark as paid"
      }
      className={`inline-flex min-h-[28px] items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 print:hidden ${
        error
          ? "border border-red-200 text-red-500"
          : paid
            ? "bg-[#22C55E]/10 text-[#16a34a] hover:bg-[#22C55E]/20"
            : "border border-gray-200 text-gray-400 hover:border-[#22C55E] hover:text-[#22C55E]"
      }`}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : paid ? (
        <Check className="h-3 w-3" />
      ) : null}
      {error ? "retry" : paid ? "paid" : "mark paid"}
    </button>
  );
}
