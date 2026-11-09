"use client";

// The edit-official modal's sign-up controls (0124), rendered only when the
// org has officials sign-up:
//   * Divisions they can work — "All divisions" (no list) or "Only these".
//     Read on open; an unreadable list shows an error and can't be saved
//     (saving over a list we couldn't read would be a guess). Saved through
//     set_official_divisions, which writes immediately.
//   * "Copy new link (the old one stops working)" — official_issue_link mints
//     a fresh link and revokes the old one; the new one is copied, or shown
//     when the browser refuses the clipboard. Only its hash is stored, so a
//     link can never be shown twice.
// No <form> here: this sits inside the modal's <form> (see
// official-profile-sections.tsx — a nested form loses its submit).

import { useEffect, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { officialLinkUrl } from "@/lib/officials-signup/page";
import * as W from "@/lib/officials-signup/words";

export type SignupDivision = { id: string; name: string };

export function OfficialSignupSection({
  umpireId,
  divisions,
  enabled,
}: {
  umpireId: string;
  divisions: SignupDivision[];
  enabled: boolean;
}) {
  const [loaded, setLoaded] = useState<"loading" | "error" | "ok">("loading");
  const [onlySome, setOnlySome] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [divNotice, setDivNotice] = useState<{ ok: boolean; line: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState<{ ok: boolean; line: string } | null>(null);
  const [shownLink, setShownLink] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await createClient()
        .from("official_divisions")
        .select("division_id")
        .eq("umpire_id", umpireId);
      if (cancelled) return;
      if (error) {
        setLoaded("error");
        return;
      }
      const ids = ((data ?? []) as { division_id: string }[]).map((r) => r.division_id);
      setPicked(new Set(ids));
      setOnlySome(ids.length > 0);
      setLoaded("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, [umpireId]);

  async function saveDivisions() {
    setSaving(true);
    setDivNotice(null);
    const ids = onlySome ? Array.from(picked) : [];
    const { data, error } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
      "set_official_divisions",
      { p_umpire_id: umpireId, p_division_ids: ids },
    );
    setSaving(false);
    const n = (data as { divisions?: unknown } | null)?.divisions;
    if (error || n !== ids.length) {
      setDivNotice({ ok: false, line: W.adminErrorLine(error?.message, W.DIVISIONS_FAILED) });
      return;
    }
    setDivNotice({ ok: true, line: W.DIVISIONS_SAVED });
  }

  async function copyNewLink() {
    setLinkBusy(true);
    setLinkNotice(null);
    setShownLink(null);
    const { data, error } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
      "official_issue_link",
      { p_umpire_id: umpireId },
    );
    setLinkBusy(false);
    const token = (data as { token?: unknown } | null)?.token;
    if (error || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
      setLinkNotice({ ok: false, line: W.adminErrorLine(error?.message, W.COPY_FAILED) });
      return;
    }
    const url = officialLinkUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setLinkNotice({ ok: true, line: W.COPIED });
    } catch {
      setLinkNotice({ ok: true, line: W.COPY_SHOW });
      setShownLink(url);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-3">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-700">{W.DIVISIONS_LABEL}</span>
        {loaded === "loading" && <p className="text-xs text-gray-500"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />…</p>}
        {loaded === "error" && <p className="text-xs text-red-600">{W.DIVISIONS_FAILED}</p>}
        {loaded === "ok" && (
          <>
            <div className="flex flex-wrap gap-2">
              {[false, true].map((some) => (
                <button
                  key={String(some)}
                  type="button"
                  onClick={() => setOnlySome(some)}
                  className={`min-h-[40px] rounded-lg border px-3 text-sm ${onlySome === some ? "border-[#22C55E] bg-green-50 text-[#0C1F3F]" : "border-gray-200 text-gray-600"}`}
                >
                  {some ? W.DIVISIONS_SOME : W.DIVISIONS_ALL}
                </button>
              ))}
            </div>
            {onlySome && (
              <div className="flex flex-col">
                {divisions.map((d) => (
                  <label key={d.id} className="flex min-h-[40px] items-center gap-3 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={picked.has(d.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(d.id);
                        else next.delete(d.id);
                        setPicked(next);
                      }}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
            <div>
              <button
                type="button"
                onClick={saveDivisions}
                disabled={saving || (onlySome && picked.size === 0)}
                className="min-h-[40px] rounded-lg bg-[#0C1F3F] px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save divisions"}
              </button>
            </div>
            {divNotice && <p className={`text-xs ${divNotice.ok ? "text-[#16a34a]" : "text-red-600"}`}>{divNotice.line}</p>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={copyNewLink}
          disabled={linkBusy || !enabled}
          title={enabled ? undefined : W.COPY_OFF}
          className="inline-flex min-h-[40px] w-fit items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-[#0C1F3F] disabled:opacity-50"
        >
          {linkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {W.COPY_LINK}
        </button>
        {!enabled && <p className="text-xs text-gray-500">{W.COPY_OFF}</p>}
        {linkNotice && <p className={`text-xs ${linkNotice.ok ? "text-[#16a34a]" : "text-red-600"}`}>{linkNotice.line}</p>}
        {shownLink && (
          <input
            readOnly
            value={shownLink}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800"
          />
        )}
      </div>
    </div>
  );
}
