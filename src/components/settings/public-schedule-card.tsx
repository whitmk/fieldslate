"use client";

// Settings → Public schedule (0105). One link per league for families and for
// the league's own website.
//
// Writes, all as the signed-in admin:
//   * on/off  → set_public_schedule_enabled (off keeps the token)
//   * reset   → reset_public_schedule_link, behind a confirm that says existing
//               website embeds stop working
//   * a park's home flag → a plain locations update under the existing
//     "Org members can manage locations" policy, chained with .select("id") so
//     a refused or zero-row write is reported, never assumed.
//
// What visitors see changes within a minute (the page's data is cached at the
// edge for 60 seconds) — the card says so instead of implying it is instant.

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SeasonUpgradeModal } from "@/components/plan/UpgradeModal";
import { createClient } from "@/lib/supabase/client";
import type { Plan } from "@/lib/plan/limits";
import { isProPlus } from "@/lib/plan/limits";
import { embedCode, publicScheduleFeedUrls, publicScheduleUrl } from "@/lib/public-schedule/links";

export type PublicScheduleCardData =
  | {
      ok: true;
      link: { token: string; enabled: boolean } | null;
      parks: { id: string; name: string; isHome: boolean; fieldCount: number }[];
      loneFields: { id: string; name: string }[];
      seasons: { id: string; name: string; divisions: { id: string; name: string; locked: boolean }[] }[];
    }
  | { ok: false };

interface Props {
  orgId: string;
  orgName: string | null;
  plan: Plan;
  data: PublicScheduleCardData;
}

export function PublicScheduleCard({ orgId, orgName, plan, data }: Props) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const paid = isProPlus(plan);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-2xl text-sm text-gray-500">
          A page with every game in your current season, for families and for your league&apos;s website. Games at
          your home parks show as <b className="text-gray-700">Home</b>; games anywhere else show as{" "}
          <b className="text-gray-700">Away</b>.
        </p>
        {!paid ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <Lock className="h-4 w-4 text-gray-400" />
              The public schedule is available on Pro and Elite.
            </p>
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Upgrade to turn it on
            </button>
          </div>
        ) : !data.ok ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            Couldn&apos;t load your public schedule settings. Refresh the page to try again.
          </p>
        ) : (
          <PaidBody orgId={orgId} orgName={orgName} data={data} />
        )}
      </CardContent>
      {upgradeOpen && <SeasonUpgradeModal reason="locked-feature" orgId={orgId} onClose={() => setUpgradeOpen(false)} />}
    </Card>
  );
}

function PaidBody({
  orgId,
  orgName,
  data,
}: {
  orgId: string;
  orgName: string | null;
  data: Extract<PublicScheduleCardData, { ok: true }>;
}) {
  const [link, setLink] = useState(data.link);
  const [parks, setParks] = useState(data.parks);
  const [busy, setBusy] = useState<null | "toggle" | "reset" | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const enabled = link?.enabled === true;

  async function toggle() {
    setBusy("toggle");
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { data: res, error: err } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0105)
      "set_public_schedule_enabled",
      { p_org_id: orgId, p_enabled: !enabled },
    );
    setBusy(null);
    const r = res as { enabled: boolean; token: string | null } | null;
    if (err || !r) {
      setError(
        err?.message?.includes("plan_required")
          ? "Your plan doesn't include the public schedule."
          : "Couldn't change the page. Please try again.",
      );
      return;
    }
    setLink(r.token ? { token: r.token, enabled: r.enabled } : null);
    setNotice(r.enabled ? "The page is on." : "The page is off. Visitors see “This schedule isn't available” within a minute.");
  }

  async function reset() {
    setBusy("reset");
    setResetError(null);
    const supabase = createClient();
    const { data: res, error: err } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0105)
      "reset_public_schedule_link",
      { p_org_id: orgId },
    );
    setBusy(null);
    const r = res as { enabled: boolean; token: string } | null;
    if (err || !r?.token) {
      setResetError("Couldn't reset the link. Nothing changed — please try again.");
      return;
    }
    setLink({ token: r.token, enabled: r.enabled });
    setConfirmReset(false);
    setNotice("New link made. Update your website with the new embed code.");
  }

  async function setHome(parkId: string, isHome: boolean) {
    setBusy(parkId);
    setError(null);
    setParks((ps) => ps.map((p) => (p.id === parkId ? { ...p, isHome } : p)));
    const supabase = createClient();
    const { data: rows, error: err } = await supabase
      .from("locations")
      .update({ is_home_park: isHome })
      .eq("id", parkId)
      .select("id");
    setBusy(null);
    if (err || !rows || rows.length === 0) {
      setParks((ps) => ps.map((p) => (p.id === parkId ? { ...p, isHome: !isHome } : p)));
      setError("Couldn't save that park. Nothing changed — please try again.");
    }
  }

  const feed = link ? publicScheduleFeedUrls(link.token) : null;

  return (
    <div className="mt-2 max-w-3xl divide-y divide-gray-100">
      <Row>
        <div>
          <p className="text-sm font-semibold text-gray-900">Public page is {enabled ? "on" : "off"}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Turning it off shows visitors &ldquo;This schedule isn&apos;t available.&rdquo; Turning it back on brings
            back the same link, so your website keeps working.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Public page"
          disabled={busy !== null}
          onClick={toggle}
          className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-[#15803d]" : "bg-gray-300"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
        </button>
      </Row>

      {(error || notice) && (
        <p className={`py-2 text-xs font-medium ${error ? "text-red-600" : "text-[#16a34a]"}`}>{error ?? notice}</p>
      )}

      {link ? (
        <>
          <Block title="Link" detail="Always shows your current season, so you don't need to change your website each season.">
            <CopyField value={publicScheduleUrl(link.token)} open />
          </Block>
          <Block title="Put it on your website" detail="Paste this into your site builder's “Embed” or “HTML” block.">
            <CopyField value={embedCode(link.token, orgName)} multiline />
          </Block>
          <Block
            title="Calendar subscription (all games)"
            detail="For anyone who wants every league game on their phone. Team calendars are on the Teams page."
          >
            <CopyField value={feed!.webcal} />
          </Block>
        </>
      ) : (
        <p className="py-3 text-sm text-gray-500">Turn the page on to get your link and embed code.</p>
      )}

      <Block title="Your home parks" detail="Games at these parks show as Home. Games anywhere else show as Away. This applies to every season.">
        {parks.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            You haven&apos;t grouped any fields into parks yet, so every game shows as Away.{" "}
            <Link href="/dashboard/venues" className="font-medium text-[#0C1F3F] underline">Set up parks on the Venues page</Link>.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {parks.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  p.isHome ? "border-[#15803d] bg-[#f0fdf4] font-semibold text-[#15803d]" : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={p.isHome}
                  disabled={busy !== null}
                  onChange={(e) => setHome(p.id, e.target.checked)}
                  className="h-4 w-4 accent-[#15803d]"
                />
                {p.name}
                <span className="text-xs font-normal text-gray-500">
                  · {p.fieldCount} {p.fieldCount === 1 ? "field" : "fields"}
                </span>
                {busy === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </label>
            ))}
          </div>
        )}
        {data.loneFields.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <span>
                {data.loneFields.length === 1 ? "This field isn't" : `These ${data.loneFields.length} fields aren't`} in a park, so
                games there show as Away: <b>{data.loneFields.map((f) => f.name).join(", ")}</b>.{" "}
                <Link href="/dashboard/venues" className="font-medium underline">Add them to a park on the Venues page</Link>.
              </span>
            </p>
          </div>
        )}
      </Block>

      <Block title="Divisions on the page" detail="Only locked divisions show, so a schedule you're still editing never goes public.">
        {data.seasons.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">You have no active season.</p>
        ) : (
          data.seasons.map((s) => (
            <div key={s.id} className="mt-2">
              {data.seasons.length > 1 && <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{s.name}</p>}
              {s.divisions.length === 0 ? (
                <p className="text-sm text-gray-500">No divisions yet.</p>
              ) : (
                <ul className="mt-1 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
                  {s.divisions.map((d) => (
                    <li key={d.id} className="contents">
                      <span className="text-gray-800">{d.name}</span>
                      {d.locked ? (
                        <span className="text-right text-gray-500">Shown · locked</span>
                      ) : (
                        <Link
                          href={`/dashboard/leagues/${s.id}?division=${d.id}`}
                          className="text-right font-medium text-[#0C1F3F] underline"
                        >
                          Hidden · not locked
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </Block>

      {link && (
        <Row>
          <div>
            <p className="text-sm font-semibold text-gray-900">Reset link</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Makes a new link. The old one stops working within a minute, including on your website.
            </p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setResetError(null);
              setConfirmReset(true);
            }}
            className="whitespace-nowrap text-sm font-semibold text-red-700 hover:underline disabled:opacity-60"
          >
            Reset link…
          </button>
        </Row>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Reset your public schedule link?"
          detail="The current link stops working. Any website that embeds your schedule, and anyone who saved the link or subscribed to the all-games calendar, will see “This schedule link isn't recognized” until you paste the new link and embed code."
          confirmLabel="Reset link"
          tone="danger"
          busy={busy === "reset"}
          error={resetError}
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-4">{children}</div>;
}

function Block({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
      {children}
    </div>
  );
}

function CopyField({ value, multiline = false, open = false }: { value: string; multiline?: boolean; open?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-2 flex items-start gap-2">
      <code
        className={`min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 ${
          multiline ? "whitespace-pre-wrap break-all" : "truncate"
        }`}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      {open && (
        <a
          href={value}
          target="_blank"
          rel="noopener"
          className="inline-flex flex-none items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Open <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
