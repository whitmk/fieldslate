"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShoppingBag, X, Printer, Mail, Loader2 } from "lucide-react";
import { SnackShackEmailModal } from "@/components/snack-shack/snack-shack-email-modal";

type Block = {
  date: string;
  start_time: string;
  end_time: string;
};

type BlockRaw = Block & {
  snack_shack_settings: {
    leagues: { name: string; season: string | null } | null;
  } | null;
};

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

interface Props {
  teamId: string;
  teamName: string;
}

export function TeamSnackShackButton({ teamId, teamName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [seasonName, setSeasonName] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  async function handleOpen() {
    setOpen(true);
    if (blocks !== null) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("snack_shack_blocks")
      .select(
        "date, start_time, end_time, snack_shack_settings(leagues(name, season))",
      )
      .eq("assigned_team_id", teamId)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    setLoading(false);
    const rows = (data as unknown as BlockRaw[]) ?? [];
    const firstLeague = rows[0]?.snack_shack_settings?.leagues;
    if (firstLeague) {
      setSeasonName(
        `${firstLeague.name}${firstLeague.season ? ` · ${firstLeague.season}` : ""}`,
      );
    }
    setBlocks(rows.map(({ date, start_time, end_time }) => ({ date, start_time, end_time })));
  }

  function handleClose() {
    setOpen(false);
    setEmailOpen(false);
  }

  function handlePrint() {
    const el = printRef.current;
    if (!el) return;
    el.classList.add("print-active");
    window.print();
    el.classList.remove("print-active");
  }

  async function sendEmail(email: string) {
    const res = await fetch(`/api/snack-shack/team/${teamId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to send.");
  }

  return (
    <>
      {/* Hidden print region — outside the modal so it anchors to the page */}
      {blocks !== null && (
        <div ref={printRef} className="fieldslate-snack-print-ready" aria-hidden>
          <div className="fieldslate-print-header">
            <div className="fieldslate-print-wordmark">
              Field<span>Slate</span>
            </div>
            <div className="fieldslate-print-league">
              Snack Shack — {teamName}
            </div>
            {seasonName && (
              <div className="fieldslate-print-meta">{seasonName}</div>
            )}
          </div>
          {blocks.length === 0 ? (
            <p style={{ fontSize: "10pt", color: "#666" }}>
              No snack shack blocks assigned.
            </p>
          ) : (
            <table className="fieldslate-print-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b, i) => (
                  <tr key={i}>
                    <td>{fmtDate(b.date)}</td>
                    <td>
                      {fmtTime(b.start_time)} – {fmtTime(b.end_time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <button
        onClick={handleOpen}
        title="View snack shack schedule"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        Snack shack
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={handleClose}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Snack Shack Schedule
                </p>
                <h2 className="mt-0.5 font-semibold text-[#0C1F3F]">
                  {teamName}
                </h2>
                {seasonName && (
                  <p className="mt-0.5 text-xs text-gray-500">{seasonName}</p>
                )}
              </div>
              <button
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                </div>
              ) : blocks === null ? null : blocks.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <ShoppingBag className="mb-3 h-8 w-8 text-gray-200" />
                  <p className="text-sm font-medium text-gray-900">
                    No blocks assigned
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    This team has no snack shack assignments yet.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-gray-500">
                      <th className="pb-3 font-semibold">Date</th>
                      <th className="pb-3 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {blocks.map((b, i) => (
                      <tr key={i} className="text-gray-700">
                        <td className="py-3 font-medium text-gray-900 tabular-nums">
                          {fmtDate(b.date)}
                        </td>
                        <td className="py-3 tabular-nums text-gray-600">
                          {fmtTime(b.start_time)} – {fmtTime(b.end_time)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer actions */}
            {blocks !== null && blocks.length > 0 && (
              <div className="flex items-center gap-2 border-t border-gray-100 px-6 py-4">
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>
                <button
                  onClick={() => setEmailOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                >
                  <Mail className="h-4 w-4" />
                  Email
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {emailOpen && (
        <SnackShackEmailModal
          title={`Email schedule — ${teamName}`}
          onSend={sendEmail}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </>
  );
}
