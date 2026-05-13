import { ArrowLeftRight } from "lucide-react";

export default function InterleaguePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0C1F3F]/[0.07]">
        <ArrowLeftRight className="h-6 w-6 text-[#0C1F3F]" />
      </div>
      <h1 className="mt-5 text-xl font-bold text-[#0C1F3F]">Interleague</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        Schedule cross-division and cross-league matchups. This feature is coming soon.
      </p>
    </div>
  );
}
