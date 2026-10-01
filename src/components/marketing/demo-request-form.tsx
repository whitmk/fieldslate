"use client";

// "Request a demo" form — the client half. Every option list and length cap
// comes from src/lib/forms/demo-request.ts, the same module the API route
// validates with, so the two cannot disagree. Submitted as JSON to
// /api/demo-request; nothing ever goes into a URL. The honeypot field is the
// shared one from src/lib/forms/spam.ts, rendered exactly as the contact
// form renders it.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send, X } from "lucide-react";
import { HONEYPOT_FIELD } from "@/lib/forms/spam";
import {
  DEMO_INTERLEAGUE,
  DEMO_LIMITS,
  DEMO_ROLES,
  DEMO_SPORTS,
  DEMO_TIMEZONES,
} from "@/lib/forms/demo-request";

const INPUT =
  "h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";
const SELECT =
  "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";
const TEXTAREA =
  "w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function DemoRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [role, setRole] = useState("");
  const [sport, setSport] = useState("");
  const [phone, setPhone] = useState("");
  const [divisionsTeams, setDivisionsTeams] = useState("");
  const [fieldsParks, setFieldsParks] = useState("");
  const [interleague, setInterleague] = useState("");
  const [schedulingTool, setSchedulingTool] = useState("");
  const [registrationPlatform, setRegistrationPlatform] = useState("");
  const [nextSeason, setNextSeason] = useState("");
  const [timezone, setTimezone] = useState("");
  const [bestTimes, setBestTimes] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    isValidEmail(email.trim()) &&
    leagueName.trim().length > 0 &&
    (DEMO_ROLES as readonly string[]).includes(role) &&
    (DEMO_SPORTS as readonly string[]).includes(sport) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          league_name: leagueName,
          role,
          sport,
          phone,
          divisions_teams: divisionsTeams,
          fields_parks: fieldsParks,
          plays_interleague: interleague,
          current_scheduling_tool: schedulingTool,
          registration_platform: registrationPlatform,
          next_season_start: nextSeason,
          timezone,
          best_times: bestTimes,
          notes,
          [HONEYPOT_FIELD]: honeypot,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ??
            "We couldn't send your request. Please try again, or email us at hello@thefieldslate.com.",
        );
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again, or email us at hello@thefieldslate.com.");
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-[#22C55E]/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <CheckCircle2 className="h-7 w-7 text-[#22C55E]" />
        </div>
        <h2 className="text-xl font-semibold text-[#0C1F3F]">Thanks — request received</h2>
        <p className="mt-2 text-sm text-gray-600">
          Thanks — Whit will email you within one business day with a few times that work.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex flex-col gap-5 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8"
      noValidate
    >
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="-mr-1 -mt-1 rounded-md p-1 hover:bg-black/5">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Honeypot — off-screen, skipped by tab and screen readers; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="demo-website">Website</label>
        <input
          id="demo-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">About you</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="demo-name" required>
          <input id="demo-name" type="text" required maxLength={DEMO_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={INPUT} placeholder="Your name" />
        </Field>
        <Field label="Email" htmlFor="demo-email" required>
          <input id="demo-email" type="email" required maxLength={DEMO_LIMITS.email} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={INPUT} placeholder="you@example.com" />
        </Field>
        <Field label="League name" htmlFor="demo-league" required>
          <input id="demo-league" type="text" required maxLength={DEMO_LIMITS.league_name} value={leagueName} onChange={(e) => setLeagueName(e.target.value)} autoComplete="organization" className={INPUT} placeholder="e.g. Westside Little League" />
        </Field>
        <Field label="Your role" htmlFor="demo-role" required>
          <select id="demo-role" required value={role} onChange={(e) => setRole(e.target.value)} className={SELECT}>
            <option value="" disabled>Choose one…</option>
            {DEMO_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Sport" htmlFor="demo-sport" required>
          <select id="demo-sport" required value={sport} onChange={(e) => setSport(e.target.value)} className={SELECT}>
            <option value="" disabled>Choose one…</option>
            {DEMO_SPORTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Phone" htmlFor="demo-phone" hint="if you'd rather we call or text">
          <input id="demo-phone" type="tel" maxLength={DEMO_LIMITS.phone} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className={INPUT} placeholder="(707) 555-0123" />
        </Field>
      </div>

      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">About your league</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Roughly how many divisions and teams?" htmlFor="demo-divisions">
          <input id="demo-divisions" type="text" maxLength={DEMO_LIMITS.divisions_teams} value={divisionsTeams} onChange={(e) => setDivisionsTeams(e.target.value)} className={INPUT} placeholder="e.g. 5 divisions, about 40 teams" />
        </Field>
        <Field label="How many fields or parks do you share?" htmlFor="demo-fields">
          <input id="demo-fields" type="text" maxLength={DEMO_LIMITS.fields_parks} value={fieldsParks} onChange={(e) => setFieldsParks(e.target.value)} className={INPUT} placeholder="e.g. 6 fields across 2 parks" />
        </Field>
        <Field label="Do you play other leagues (interleague)?" htmlFor="demo-interleague">
          <select id="demo-interleague" value={interleague} onChange={(e) => setInterleague(e.target.value)} className={SELECT}>
            <option value="">Choose one…</option>
            {DEMO_INTERLEAGUE.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Current scheduling tool" htmlFor="demo-tool">
          <input id="demo-tool" type="text" maxLength={DEMO_LIMITS.current_scheduling_tool} value={schedulingTool} onChange={(e) => setSchedulingTool(e.target.value)} className={INPUT} placeholder="e.g. a spreadsheet" />
        </Field>
        <Field label="Registration platform" htmlFor="demo-registration">
          <input id="demo-registration" type="text" maxLength={DEMO_LIMITS.registration_platform} value={registrationPlatform} onChange={(e) => setRegistrationPlatform(e.target.value)} className={INPUT} placeholder="Whatever you use for sign-ups" />
        </Field>
        <Field label="When does your next season start?" htmlFor="demo-season">
          <input id="demo-season" type="text" maxLength={DEMO_LIMITS.next_season_start} value={nextSeason} onChange={(e) => setNextSeason(e.target.value)} className={INPUT} placeholder="e.g. early March" />
        </Field>
      </div>

      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Reaching you</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Time zone" htmlFor="demo-timezone">
          <select id="demo-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={SELECT}>
            <option value="">Choose one…</option>
            {DEMO_TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Good times to talk" htmlFor="demo-times">
          <input id="demo-times" type="text" maxLength={DEMO_LIMITS.best_times} value={bestTimes} onChange={(e) => setBestTimes(e.target.value)} className={INPUT} placeholder="e.g. weekday evenings after 7" />
        </Field>
      </div>

      <Field label="Anything else?" htmlFor="demo-notes">
        <textarea id="demo-notes" maxLength={DEMO_LIMITS.notes} value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={TEXTAREA} placeholder="What's hardest about your schedule today?" />
      </Field>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#22C55E] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {submitting ? "Sending…" : "Request a demo"}
      </button>

      <p className="text-center text-[11px] text-gray-400">
        We use what you share here only to set up and prepare for your demo.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-1 font-normal text-gray-400">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
