"use client";

// Settings → Officials sign-up (0124). Rendered for an org whose switch is on
// (loadOfficialSignup) — every league unless switched off (0127). A league
// that isn't Elite sees the Elite line and an Upgrade button.
//   * contact email → ContactEmailField (0126): a new address is used only
//                     once the link emailed to it is confirmed. Never defaults
//                     to an account email.
//   * on/off        → set_official_signup_enabled (on needs Elite + a
//                     CONFIRMED contact), as the signed-in admin.
// Every sentence comes from src/lib/officials-signup/words.ts.

import { useState } from "react";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ContactEmailField } from "@/components/settings/contact-email-field";
import { SeasonUpgradeModal } from "@/components/plan/UpgradeModal";
import type { OfficialSignupState } from "@/lib/officials-signup/feature-state";
import * as W from "@/lib/officials-signup/words";

export function OfficialSignupCard({ orgId, data }: { orgId: string; data: OfficialSignupState }) {
  const [enabled, setEnabled] = useState(data.enabled);
  const [saved, setSaved] = useState(data.contactEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const blocked = !enabled && !saved ? W.CARD_NEEDS_CONTACT : null;

  async function toggle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data: res, error: err } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
      "set_official_signup_enabled",
      { p_org_id: orgId, p_enabled: !enabled },
    );
    setBusy(false);
    const r = res as { enabled?: unknown } | null;
    if (err || typeof r?.enabled !== "boolean") {
      setError(W.adminErrorLine(err?.message, W.SOMETHING_WRONG));
      return;
    }
    setEnabled(r.enabled);
    setNotice(W.CARD_SAVED);
  }

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
              {W.CARD_NEEDS_ELITE}
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
          <div className="mt-2 max-w-3xl divide-y divide-gray-100">
            <ContactEmailField
              orgId={orgId}
              kind="official_signup"
              initialContact={data.contactEmail}
              switchOn={enabled}
              inputId="official-contact"
              title={W.CARD_CONTACT_LABEL}
              detail={W.CARD_CONTACT_HINT}
              placeholder="umpires@yourleague.org"
              onConfirmedChange={setSaved}
            />
            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">{W.CARD_ON}</p>
                {blocked && <p className="mt-1 text-xs font-medium text-amber-700">{blocked}</p>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={W.CARD_ON}
                disabled={busy || blocked !== null}
                onClick={toggle}
                className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-[#15803d]" : "bg-gray-300"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
              </button>
            </div>
            {(error || notice) && (
              <p className={`py-2 text-xs font-medium ${error ? "text-red-600" : "text-[#16a34a]"}`}>{error ?? notice}</p>
            )}
          </div>
        )}
      </CardContent>
      {upgradeOpen && <SeasonUpgradeModal reason="locked-feature" orgId={orgId} onClose={() => setUpgradeOpen(false)} />}
    </Card>
  );
}
