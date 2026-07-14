"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getOfficialTitleLower } from "@/lib/utils/official-title";
import {
  coachTeamLabel,
  fetchCoachTeamOptions,
  type CoachTeamOption,
} from "@/lib/umpires/team-options";

export type SeasonOption = { id: string; name: string; sport?: string | null };

interface Props {
  seasons: SeasonOption[];
}

export function AddUmpireButton({ seasons }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [designation, setDesignation] = useState<"youth" | "adult">("youth");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [maxGames, setMaxGames] = useState("");
  const [notes, setNotes] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<CoachTeamOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Coached-team options follow the selected season (coach conflict link,
  // migration 0063). Season change resets the pick — teams don't carry over.
  useEffect(() => {
    if (!open || !seasonId) {
      setTeams([]);
      setTeamId("");
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    fetchCoachTeamOptions(supabase, seasonId).then((options) => {
      if (cancelled) return;
      setTeams(options);
      setTeamId("");
    });
    return () => {
      cancelled = true;
    };
  }, [open, seasonId]);

  function openModal() {
    if (seasons.length === 0) return;
    setName("");
    setSeasonId(seasons.length === 1 ? seasons[0].id : "");
    setDesignation("youth");
    setEmail("");
    setPhone("");
    setMaxGames("");
    setNotes("");
    setTeamId("");
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !seasonId) return;
    setSaving(true);
    setError("");

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("umpires")
      .insert([{
        season_id: seasonId,
        name: name.trim(),
        designation,
        email: email.trim() || null,
        phone: phone.trim() || null,
        max_games_per_week:
          maxGames !== "" ? Math.max(1, parseInt(maxGames, 10) || 1) : null,
        notes: notes.trim() || null,
        team_id: teamId || null,
      }] as never);

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  const disabled = seasons.length === 0;

  const selectedSeason = seasons.find((s) => s.id === seasonId);
  const uniqueSports = Array.from(new Set(seasons.map((s) => s.sport ?? "")));
  // Use the selected season's sport if one is chosen; otherwise the only sport
  // across all seasons; otherwise fall back to neutral "official".
  const contextSport = selectedSeason?.sport ?? (uniqueSports.length === 1 ? uniqueSports[0] : "");
  const titleLower = getOfficialTitleLower(contextSport);

  return (
    <>
      <Button
        size="sm"
        onClick={openModal}
        disabled={disabled}
        title={disabled ? "Create a season first" : undefined}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add {titleLower}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-[#0C1F3F]">Add {titleLower}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-5 overflow-y-auto px-6 py-6"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jamie Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              {seasons.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">Season</label>
                  <select
                    value={seasonId}
                    onChange={(e) => setSeasonId(e.target.value)}
                    required
                    className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                  >
                    <option value="">Select a season…</option>
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-gray-700">Designation</span>
                <div className="flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1">
                  {(["youth", "adult"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDesignation(d)}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-all ${
                        designation === d
                          ? "bg-white text-[#0C1F3F] shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Email <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="ump@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Phone <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="tel"
                  placeholder="(555) 555-5555"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Max games per week{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="No limit"
                  value={maxGames}
                  onChange={(e) => setMaxGames(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              {seasonId && teams.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    Coaches team{" "}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <select
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                  >
                    <option value="">— None —</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {coachTeamLabel(t.name, t.division?.name)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400">
                    Auto-assign skips games involving this team; manual
                    assignments show a warning.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Notes <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Prefers weekend games…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim() || !seasonId}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    `Add ${titleLower}`
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
