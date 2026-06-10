"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Award,
  CalendarOff,
  ChevronDown,
  Clock,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Availability / blackout / certification sections for the per-official page
// (tables from migration 0062). Rows are fetched server-side by the page and
// passed in; mutations write directly and router.refresh() reloads.

export type AvailabilityRow = {
  id: string;
  day_of_week: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export type BlackoutRow = {
  id: string;
  date: string; // "YYYY-MM-DD"
  note: string | null;
};

export type CertificationRow = {
  id: string;
  name: string;
  issued_date: string | null;
  expiry_date: string | null;
};

const DAY_OPTIONS: { key: string; full: string }[] = [
  { key: "Mo", full: "Monday" },
  { key: "Tu", full: "Tuesday" },
  { key: "We", full: "Wednesday" },
  { key: "Th", full: "Thursday" },
  { key: "Fr", full: "Friday" },
  { key: "Sa", full: "Saturday" },
  { key: "Su", full: "Sunday" },
];
const DAY_INDEX = new Map(DAY_OPTIONS.map((d, i) => [d.key, i]));

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dayFull(key: string): string {
  return DAY_OPTIONS.find((d) => d.key === key)?.full ?? key;
}

function fmtClock(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// Format "YYYY-MM-DD" from string parts — date-only values must never pass
// through new Date(iso), which parses as UTC midnight and can shift a day.
function fmtDateOnly(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  return `${MONTHS_SHORT[(mo ?? 1) - 1]} ${d}, ${y}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function expiryStatus(expiry: string | null): "past" | "soon" | "ok" | "none" {
  if (!expiry) return "none";
  const today = localDateStr(new Date());
  if (expiry < today) return "past";
  const soonCutoff = new Date();
  soonCutoff.setDate(soonCutoff.getDate() + 30);
  if (expiry <= localDateStr(soonCutoff)) return "soon";
  return "ok";
}

const inputClasses =
  "h-11 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

// ── Shared collapsible section shell ─────────────────────────────────────────

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50/60"
      >
        <span className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-[#0C1F3F]">{title}</span>
          <span className="text-xs text-gray-400">{count}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-gray-50 px-4 py-4">{children}</div>}
    </div>
  );
}

function AddRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-500 transition-colors hover:border-[#22C55E] hover:text-[#22C55E] md:min-h-0 md:py-1.5"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}

function DeleteRowButton({
  onClick,
  busy,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 md:h-8 md:w-8"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
      {message}
    </p>
  );
}

function FormActions({
  saving,
  onCancel,
}: {
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="min-h-[44px] flex-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50 md:min-h-0 md:flex-none md:py-1.5"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50 md:min-h-0 md:flex-none md:py-1.5"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ── Availability ─────────────────────────────────────────────────────────────

function AvailabilitySection({
  umpireId,
  rows,
}: {
  umpireId: string;
  rows: AvailabilityRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState("Mo");
  const [start, setStart] = useState("17:00");
  const [end, setEnd] = useState("20:00");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...rows].sort(
    (a, b) =>
      (DAY_INDEX.get(a.day_of_week) ?? 0) - (DAY_INDEX.get(b.day_of_week) ?? 0) ||
      a.start_time.localeCompare(b.start_time),
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!start || !end) return;
    if (end <= start) {
      setError("End time must be after start time.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: insertErr } = await supabase
      .from("official_availability")
      .insert([
        { umpire_id: umpireId, day_of_week: day, start_time: start, end_time: end },
      ] as never[]);
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setAdding(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("official_availability")
      .delete()
      .eq("id", id);
    setDeletingId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    router.refresh();
  }

  return (
    <Section
      icon={<Clock className="h-4 w-4 text-[#22C55E]" />}
      title="Availability"
      count={rows.length}
    >
      <div className="flex flex-col gap-2">
        {sorted.length === 0 && !adding && (
          <p className="text-sm text-gray-400">
            No weekly availability set — treated as available any time.
          </p>
        )}
        {sorted.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-1.5"
          >
            <span className="text-sm text-gray-700">
              <span className="font-medium text-[#0C1F3F]">{dayFull(r.day_of_week)}</span>{" "}
              · {fmtClock(r.start_time)} – {fmtClock(r.end_time)}
            </span>
            <DeleteRowButton
              onClick={() => handleDelete(r.id)}
              busy={deletingId === r.id}
              label="Delete availability window"
            />
          </div>
        ))}

        {error && <FormError message={error} />}

        {adding ? (
          <form
            onSubmit={handleAdd}
            className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <select
                value={day}
                onChange={(e) => setDay(e.target.value)}
                aria-label="Day of week"
                className={inputClasses}
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.full}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="Start time"
                required
                className={inputClasses}
              />
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="End time"
                required
                className={inputClasses}
              />
            </div>
            <FormActions
              saving={saving}
              onCancel={() => {
                setAdding(false);
                setError(null);
              }}
            />
          </form>
        ) : (
          <AddRowButton onClick={() => setAdding(true)} label="Add window" />
        )}
      </div>
    </Section>
  );
}

// ── Blackout dates ───────────────────────────────────────────────────────────

function BlackoutsSection({
  umpireId,
  rows,
}: {
  umpireId: string;
  rows: BlackoutRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) return;
    setSaving(true);
    const supabase = createClient();
    const { error: insertErr } = await supabase
      .from("official_blackouts")
      .insert([
        { umpire_id: umpireId, date, note: note.trim() || null },
      ] as never[]);
    setSaving(false);
    if (insertErr) {
      // UNIQUE(umpire_id, date)
      setError(
        insertErr.code === "23505" || /duplicate key|unique/i.test(insertErr.message)
          ? `${fmtDateOnly(date)} is already marked unavailable.`
          : insertErr.message,
      );
      return;
    }
    setAdding(false);
    setDate("");
    setNote("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("official_blackouts")
      .delete()
      .eq("id", id);
    setDeletingId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    router.refresh();
  }

  return (
    <Section
      icon={<CalendarOff className="h-4 w-4 text-[#22C55E]" />}
      title="Blackout dates"
      count={rows.length}
    >
      <div className="flex flex-col gap-2">
        {rows.length === 0 && !adding && (
          <p className="text-sm text-gray-400">No blackout dates.</p>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-1.5"
          >
            <span className="min-w-0 text-sm text-gray-700">
              <span className="font-medium text-[#0C1F3F]">{fmtDateOnly(r.date)}</span>
              {r.note && <span className="text-gray-500"> — {r.note}</span>}
            </span>
            <DeleteRowButton
              onClick={() => handleDelete(r.id)}
              busy={deletingId === r.id}
              label="Delete blackout date"
            />
          </div>
        ))}

        {error && <FormError message={error} />}

        {adding ? (
          <form
            onSubmit={handleAdd}
            className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Blackout date"
                required
                className={inputClasses}
              />
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional)"
                className={inputClasses}
              />
            </div>
            <FormActions
              saving={saving}
              onCancel={() => {
                setAdding(false);
                setError(null);
              }}
            />
          </form>
        ) : (
          <AddRowButton onClick={() => setAdding(true)} label="Add date" />
        )}
      </div>
    </Section>
  );
}

// ── Certifications ───────────────────────────────────────────────────────────

function CertificationsSection({
  umpireId,
  rows,
}: {
  umpireId: string;
  rows: CertificationRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [issued, setIssued] = useState("");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error: insertErr } = await supabase
      .from("official_certifications")
      .insert([
        {
          umpire_id: umpireId,
          name: name.trim(),
          issued_date: issued || null,
          expiry_date: expiry || null,
        },
      ] as never[]);
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setAdding(false);
    setName("");
    setIssued("");
    setExpiry("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("official_certifications")
      .delete()
      .eq("id", id);
    setDeletingId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    router.refresh();
  }

  return (
    <Section
      icon={<Award className="h-4 w-4 text-[#22C55E]" />}
      title="Certifications"
      count={rows.length}
    >
      <div className="flex flex-col gap-2">
        {rows.length === 0 && !adding && (
          <p className="text-sm text-gray-400">No certifications recorded.</p>
        )}
        {rows.map((r) => {
          const status = expiryStatus(r.expiry_date);
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-1.5"
            >
              <span className="min-w-0 text-sm text-gray-700">
                <span className="font-medium text-[#0C1F3F]">{r.name}</span>
                {r.issued_date && (
                  <span className="text-gray-500"> · issued {fmtDateOnly(r.issued_date)}</span>
                )}
                {r.expiry_date && (
                  <span
                    className={
                      status === "past"
                        ? "font-medium text-red-600"
                        : status === "soon"
                          ? "font-medium text-amber-600"
                          : "text-gray-500"
                    }
                  >
                    {" "}
                    · {status === "past" ? "expired" : "expires"}{" "}
                    {fmtDateOnly(r.expiry_date)}
                  </span>
                )}
              </span>
              <DeleteRowButton
                onClick={() => handleDelete(r.id)}
                busy={deletingId === r.id}
                label="Delete certification"
              />
            </div>
          );
        })}

        {error && <FormError message={error} />}

        {adding ? (
          <form
            onSubmit={handleAdd}
            className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3"
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Certification name"
              required
              autoFocus
              className={inputClasses}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">
                  Issued (optional)
                </label>
                <input
                  type="date"
                  value={issued}
                  onChange={(e) => setIssued(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">
                  Expires (optional)
                </label>
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>
            <FormActions
              saving={saving}
              onCancel={() => {
                setAdding(false);
                setError(null);
              }}
            />
          </form>
        ) : (
          <AddRowButton onClick={() => setAdding(true)} label="Add certification" />
        )}
      </div>
    </Section>
  );
}

// ── Combined export ──────────────────────────────────────────────────────────

export function OfficialProfileSections({
  umpireId,
  availability,
  blackouts,
  certifications,
}: {
  umpireId: string;
  availability: AvailabilityRow[];
  blackouts: BlackoutRow[];
  certifications: CertificationRow[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <AvailabilitySection umpireId={umpireId} rows={availability} />
      <BlackoutsSection umpireId={umpireId} rows={blackouts} />
      <CertificationsSection umpireId={umpireId} rows={certifications} />
    </div>
  );
}
