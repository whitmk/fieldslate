import Link from "next/link";

export default function ConfirmedPage() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#22C55E]/15">
        <svg className="h-8 w-8 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-white">Email confirmed</h1>
      <p className="mt-2 text-sm text-white/50">
        Your email is confirmed — welcome to FieldSlate!
      </p>

      <Link
        href="/login"
        className="mt-8 flex h-11 w-full items-center justify-center rounded-lg bg-[#22C55E] text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
      >
        Sign in
      </Link>
    </div>
  );
}
