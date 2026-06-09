"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { FieldSlateLockup } from "@/components/brand";
import { SeasonUpgradeModal } from "@/components/plan/UpgradeModal";
import { useMobileSidebar } from "@/components/dashboard/mobile-sidebar";
import type { Plan } from "@/lib/plan/limits";
import {
  LayoutDashboard,
  Trophy,
  CalendarDays,
  CalendarRange,
  Users,
  MapPin,
  Layers,
  Building2,
  Medal,
  FileDown,
  Settings,
  LogOut,
  UserCheck,
  ShoppingBag,
  BarChart3,
  Lock,
  X,
  type LucideIcon,
} from "lucide-react";

// Tier-gated nav items (Item 14):
//   - tier: null     → always available
//   - tier: "pro"    → locked for Free users
//   - tier: "elite"  → locked for Free AND Pro users
//
// Locked items stay VISIBLE (Style B pill badge) but don't navigate — clicking
// opens the upgrade modal. Routes remain server-guarded as defense-in-depth, so
// a non-entitled user who deep-links still lands on the upgrade page.
type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  tier: null | "pro" | "elite";
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, tier: null },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3, tier: "elite" },
  { href: "/dashboard/leagues", label: "Seasons", icon: Trophy, tier: null },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarDays, tier: null },
  { href: "/dashboard/practices", label: "Practices", icon: CalendarRange, tier: "pro" },
  { href: "/dashboard/teams", label: "Teams", icon: Users, tier: null },
  { href: "/dashboard/venues", label: "Venues", icon: MapPin, tier: null },
  { href: "/dashboard/divisions", label: "Divisions", icon: Layers, tier: null },
  { href: "/dashboard/umpires", label: "Officials", icon: UserCheck, tier: "elite" },
  { href: "/dashboard/interleague", label: "Interleague", icon: Building2, tier: "pro" },
  { href: "/dashboard/playoffs", label: "Playoffs", icon: Medal, tier: "elite" },
  { href: "/dashboard/snack-shack", label: "Snack Shack", icon: ShoppingBag, tier: "elite" },
  { href: "/dashboard/export", label: "Export", icon: FileDown, tier: "pro" },
];

// An item is locked when its required tier outranks the org's current plan.
function isLocked(tier: NavItem["tier"], plan: Plan): boolean {
  if (tier === "pro") return plan === "free";
  if (tier === "elite") return plan !== "elite";
  return false;
}

// Style B locked-feature pill: rounded, lock icon + tier name. Light fill on the
// dark navy rail — blue for Pro, purple for Elite.
function LockBadge({ tier }: { tier: "pro" | "elite" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tier === "pro"
          ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
          : "border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9]",
      )}
    >
      <Lock className="h-3 w-3" />
      {tier === "pro" ? "Pro" : "Elite"}
    </span>
  );
}

export function Sidebar({
  plan,
  orgId,
  activeSeasonCount,
}: {
  plan: Plan;
  orgId: string;
  activeSeasonCount: number;
}) {
  const pathname = usePathname();
  // A single modal serves every locked item — they all open the same
  // locked-feature upgrade flow.
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Mobile drawer state lives in context — the open trigger is the Topbar's
  // hamburger. On md+ the drawer classes are overridden and this is inert.
  const { open: mobileOpen, setOpen: setMobileOpen } = useMobileSidebar();
  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      {/* Mobile-only backdrop — tap to dismiss the drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          // Mobile: fixed off-canvas drawer that slides in over the content
          "fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-shrink-0 flex-col bg-[#0C1F3F] transition-transform duration-200 ease-in-out print:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: static rail, identical to the pre-drawer layout
          "md:static md:z-auto md:w-64 md:translate-x-0 md:transition-none"
        )}
      >
        {/* Logo — links home; dark surface → dark variant lockup */}
        <div className="flex h-16 items-center justify-between px-6">
          <Link href="/dashboard" aria-label="FieldSlate home" className="inline-flex" onClick={closeMobile}>
            <FieldSlateLockup height={28} variant="dark" />
          </Link>
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-0.5">
            {navItems.map(({ href, label, icon: Icon, tier }) => {
              // Locked: render as a button (never navigates) with a muted label
              // and a tier badge; clicking opens the upgrade modal.
              if (isLocked(tier, plan)) {
                return (
                  <li key={href}>
                    <button
                      type="button"
                      onClick={() => setUpgradeOpen(true)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/35 transition-colors hover:bg-white/5"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-white/35" />
                      <span className="flex-1 text-left">{label}</span>
                      {/* tier is non-null here — isLocked() only returns true for gated items */}
                      <LockBadge tier={tier as "pro" | "elite"} />
                    </button>
                  </li>
                );
              }

              // Unlocked: unchanged link with active-state styling.
              const isActive =
                pathname === href ||
                (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={closeMobile}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[#22C55E]/15 text-[#22C55E]"
                        : "text-white/60 hover:bg-white/8 hover:text-white"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 flex-shrink-0",
                        isActive ? "text-[#22C55E]" : "text-white"
                      )}
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom nav */}
        <div className="border-t border-white/10 px-3 py-4">
          <ul className="flex flex-col gap-0.5">
            <li>
              <Link
                href="/dashboard/settings"
                onClick={closeMobile}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname === "/dashboard/settings"
                    ? "bg-[#22C55E]/15 text-[#22C55E]"
                    : "text-white/60 hover:bg-white/8 hover:text-white"
                )}
              >
                <Settings
                  className={cn(
                    "h-4 w-4",
                    pathname === "/dashboard/settings"
                      ? "text-[#22C55E]"
                      : "text-white"
                  )}
                />
                Settings
              </Link>
            </li>
            <li>
              <form action="/api/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/8 hover:text-white"
                >
                  <LogOut className="h-4 w-4 text-white" />
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </div>
      </aside>

      {upgradeOpen && (
        <SeasonUpgradeModal
          reason="locked-feature"
          orgId={orgId}
          currentPlan={plan}
          activeSeasonCount={activeSeasonCount}
          onClose={() => setUpgradeOpen(false)}
        />
      )}
    </>
  );
}
