"use client";

// Settings → Volunteer sign-ups (0120). Rendered for an org whose feature
// switch is on — every league unless switched off (0127); below Elite it shows
// the Elite line and an Upgrade button (see src/lib/volunteers/settings-card.ts).
//
// Writes, all as the signed-in admin, through 0120's functions:
//   * contact email → ContactEmailField (0126): a new address is used only
//                     once the link emailed to it is confirmed. Never
//                     defaults to anyone's account email.
//   * on/off        → set_volunteer_link (on needs Elite and a CONFIRMED contact;
//                     off keeps the token)
//   * reset         → reset_volunteer_link, behind a confirm
// Every sentence comes from src/lib/volunteers/words.ts.

import { useState } from "react";
import { Check, Copy, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SeasonUpgradeModal } from "@/components/plan/UpgradeModal";
import { createClient } from "@/lib/supabase/client";
import { ContactEmailField } from "@/components/settings/contact-email-field";
import { linkSwitchBlocked, volunteerSignupUrl, type VolunteerCardData } from "@/lib/volunteers/settings-card";
import * as W from "@/lib/volunteers/words";

export function VolunteersCard({ orgId, data }: { orgId: string; data: VolunteerCardData }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{W.CARD_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-2xl text-sm text-gray-500">{W.CARD_INTRO}</p>
        {!data.elite ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <Lock className="h-4 w-4 text-gray-400" />
              {W.ELITE_ONLY}
            </p>
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              {W.UPGRADE_BUTTON}
            </button>
          </div>
        ) : (
          <EliteBody orgId={orgId} data={data} />
        )}
      </CardContent>
      {upgradeOpen && <SeasonUpgradeModal reason="locked-feature" orgId={orgId} onClose={() => setUpgradeOpen(false)} />}
    </Card>
  );
}

function EliteBody({ orgId, data }: { orgId: string; data: VolunteerCardData }) {
  const [token, setToken] = useState(data.settings?.linkToken ?? null);
  const [enabled, setEnabled] = useState(data.settings?.linkEnabled ?? false);
  const [savedContact, setSavedContact] = useState(data.settings?.contactEmail ?? null);
  const [busy, setBusy] = useState<null | "toggle" | "reset">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const blocked = linkSwitchBlocked({ linkEnabled: enabled, savedContact });

  async function toggle() {
    setBusy("toggle");
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { data: res, error: err } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0120)
      "set_volunteer_link",
      { p_org_id: orgId, p_enabled: !enabled },
    );
    setBusy(null);
    const r = res as { link_enabled: boolean; link_token: string | null } | null;
    if (err || !r) {
      setError(W.settingsErrorLine(err?.message));
      return;
    }
    setEnabled(r.link_enabled);
    if (r.link_token) setToken(r.link_token);
    setNotice(r.link_enabled ? W.LINK_ON_NOTICE : W.LINK_OFF_NOTICE);
  }

  async function reset() {
    setBusy("reset");
    setResetError(null);
    const supabase = createClient();
    const { data: res, error: err } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0120)
      "reset_volunteer_link",
      { p_org_id: orgId },
    );
    setBusy(null);
    const r = res as { link_enabled: boolean; link_token: string } | null;
    if (err || !r?.link_token) {
      setResetError(W.RESET_FAILED);
      return;
    }
    setToken(r.link_token);
    setEnabled(r.link_enabled);
    setConfirmReset(false);
    setNotice(W.RESET_DONE);
  }

  return (
    <div className="mt-2 max-w-3xl divide-y divide-gray-100">
      <ContactEmailField
        orgId={orgId}
        kind="volunteers"
        initialContact={data.settings?.contactEmail ?? null}
        switchOn={enabled}
        inputId="volunteer-contact"
        title={W.CONTACT_TITLE}
        detail={W.CONTACT_DETAIL}
        placeholder="board@yourleague.org"
        onConfirmedChange={setSavedContact}
      />

      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{enabled ? W.LINK_TITLE_ON : W.LINK_TITLE_OFF}</p>
          <p className="mt-0.5 text-xs text-gray-500">{W.LINK_DETAIL}</p>
          {blocked && <p className="mt-1 text-xs font-medium text-amber-700">{blocked}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={W.CARD_TITLE}
          title={blocked ?? undefined}
          disabled={busy !== null || blocked !== null}
          onClick={toggle}
          className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-[#15803d]" : "bg-gray-300"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
        </button>
      </div>

      {(error || notice) && (
        <p className={`py-2 text-xs font-medium ${error ? "text-red-600" : "text-[#16a34a]"}`}>{error ?? notice}</p>
      )}

      {token && enabled ? (
        <div className="py-4">
          <p className="text-sm font-semibold text-gray-900">{W.LINK_BLOCK_TITLE}</p>
          <p className="mt-0.5 text-xs text-gray-500">{W.LINK_BLOCK_DETAIL}</p>
          <CopyField value={volunteerSignupUrl(token)} />
        </div>
      ) : (
        <p className="py-3 text-sm text-gray-500">{W.LINK_FIRST}</p>
      )}

      {token && (
        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{W.RESET_TITLE}</p>
            <p className="mt-0.5 text-xs text-gray-500">{W.RESET_DETAIL}</p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setResetError(null);
              setConfirmReset(true);
            }}
            className="whitespace-nowrap py-2 text-sm font-semibold text-red-700 hover:underline disabled:opacity-60"
          >
            {W.RESET_BUTTON}
          </button>
        </div>
      )}

      {confirmReset && (
        <ConfirmDialog
          title={W.RESET_CONFIRM_TITLE}
          detail={W.RESET_CONFIRM_DETAIL}
          confirmLabel={W.RESET_CONFIRM_LABEL}
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

function CopyField({ value }: { value: string }) {
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
      <code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">
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
    </div>
  );
}
