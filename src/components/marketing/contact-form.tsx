"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send, X } from "lucide-react";

const REQUEST_TYPES = [
  "General inquiry",
  "Data access request",
  "Data deletion request",
  "Data correction request",
  "Other",
] as const;

type RequestType = (typeof REQUEST_TYPES)[number];

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [requestType, setRequestType] = useState<RequestType | "">("");
  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();

  const canSubmit =
    trimmedName.length > 0 &&
    isValidEmail(trimmedEmail) &&
    REQUEST_TYPES.includes(requestType as RequestType) &&
    trimmedMessage.length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          request_type: requestType,
          message: trimmedMessage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ??
            "We couldn't send your message. Please try again, or email us directly at hello@thefieldslate.com.",
        );
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error. Please try again, or email us directly at hello@thefieldslate.com.",
      );
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-[#22C55E]/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <CheckCircle2 className="h-7 w-7 text-[#22C55E]" />
        </div>
        <h2 className="text-xl font-semibold text-[#0C1F3F]">
          Thanks — message received
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          We&apos;ll get back to you within 2 business days at{" "}
          <span className="font-medium text-[#0C1F3F]">{trimmedEmail}</span>.
        </p>
        <p className="mt-4 text-xs text-gray-400">
          For privacy / data requests we may ask follow-up questions to verify
          your identity before acting on the request.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8"
      noValidate
    >
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 rounded-md p-1 hover:bg-black/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Field label="Name" htmlFor="contact-name" required>
        <input
          id="contact-name"
          type="text"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          placeholder="Your name"
        />
      </Field>

      <Field label="Email" htmlFor="contact-email" required>
        <input
          id="contact-email"
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          placeholder="you@example.com"
        />
      </Field>

      <Field label="Request type" htmlFor="contact-type" required>
        <select
          id="contact-type"
          required
          value={requestType}
          onChange={(e) => setRequestType(e.target.value as RequestType | "")}
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        >
          <option value="" disabled>
            Choose one…
          </option>
          {REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Message" htmlFor="contact-message" required>
        <textarea
          id="contact-message"
          required
          maxLength={5000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          placeholder="Tell us what you need. For data requests, include the email tied to your FieldSlate account so we can locate your records."
        />
      </Field>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#22C55E] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {submitting ? "Sending…" : "Send message"}
      </button>

      <p className="text-center text-[11px] text-gray-400">
        We use your email only to respond to this request.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
