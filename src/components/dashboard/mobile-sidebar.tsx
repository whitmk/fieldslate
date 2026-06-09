"use client";

import { createContext, useContext, useState } from "react";
import { Menu } from "lucide-react";

// Mobile-only drawer state shared between the Topbar's hamburger trigger and
// the Sidebar drawer. Context is required because Topbar is a server component
// — the trigger and the drawer can't share useState through props. Desktop
// (md+) never reads this state; the sidebar is static there.
type MobileSidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const MobileSidebarContext = createContext<MobileSidebarContextValue | null>(null);

export function MobileSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <MobileSidebarContext.Provider value={{ open, setOpen }}>
      {children}
    </MobileSidebarContext.Provider>
  );
}

export function useMobileSidebar(): MobileSidebarContextValue {
  const ctx = useContext(MobileSidebarContext);
  if (!ctx) {
    throw new Error("useMobileSidebar must be used within MobileSidebarProvider");
  }
  return ctx;
}

// Hamburger trigger rendered in the Topbar — hidden on md+ where the sidebar
// is always visible.
export function MobileMenuButton() {
  const { setOpen } = useMobileSidebar();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open menu"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white md:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
