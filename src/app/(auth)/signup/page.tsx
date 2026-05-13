"use client";

import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (inviteCode.trim().toUpperCase() !== "FIELDSLATE2026") {
      setError("Invalid invite code.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, league_name: leagueName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10">
          <svg className="h-6 w-6 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Check your email</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/50">
          We sent a confirmation link to{" "}
          <span className="font-medium text-white/80">{email}</span>.
          <br />Click it to activate your account.
        </p>
        <Link
          href="/login"
          className="mt-6 flex h-11 w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create your account</h1>
        <p className="mt-1.5 text-sm text-white/50">
          Start scheduling your league in minutes
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Input
          id="fullName"
          label="Full name"
          type="text"
          placeholder="Jane Smith"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          variant="dark"
          autoComplete="name"
          required
        />
        <Input
          id="leagueName"
          label="League name"
          type="text"
          placeholder="Riverside Youth Baseball"
          value={leagueName}
          onChange={(e) => setLeagueName(e.target.value)}
          variant="dark"
          autoComplete="organization"
          required
        />
        <Input
          id="email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          variant="dark"
          autoComplete="email"
          required
        />
        <Input
          id="password"
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          variant="dark"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Input
          id="inviteCode"
          label="Beta invite code"
          type="text"
          placeholder="Enter your invite code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          variant="dark"
          autoComplete="off"
          required
        />

        {error && (
          <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2.5">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-[#22C55E] text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            "Create account"
          )}
        </button>

        <p className="text-center text-xs text-white/30">
          By signing up you agree to our{" "}
          <Link href="/terms" className="text-white/50 underline hover:text-white/70">Terms</Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-white/50 underline hover:text-white/70">Privacy Policy</Link>.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-white/40">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[#22C55E] hover:text-[#16a34a]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
