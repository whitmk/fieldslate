import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export async function Topbar() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "?";

  return (
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-white/10 bg-[#0C1F3F] px-6 print:hidden">
      <div />
      <div className="flex items-center gap-3">
        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white">
          <Bell className="h-4 w-4" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22C55E]/20 ring-1 ring-[#22C55E]/30">
          <span className="text-xs font-semibold text-[#22C55E]">{initials}</span>
        </div>
      </div>
    </header>
  );
}
