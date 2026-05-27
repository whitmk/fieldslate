"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { FieldSlateLockup } from "@/components/brand";
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
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/leagues", label: "Seasons", icon: Trophy },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/dashboard/practices", label: "Practices", icon: CalendarRange },
  { href: "/dashboard/teams", label: "Teams", icon: Users },
  { href: "/dashboard/venues", label: "Venues", icon: MapPin },
  { href: "/dashboard/divisions", label: "Divisions", icon: Layers },
  { href: "/dashboard/umpires", label: "Officials", icon: UserCheck },
  { href: "/dashboard/interleague", label: "Interleague", icon: Building2 },
  { href: "/dashboard/playoffs", label: "Playoffs", icon: Medal },
  { href: "/dashboard/snack-shack", label: "Snack Shack", icon: ShoppingBag },
  { href: "/dashboard/export", label: "Export", icon: FileDown },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col bg-[#0C1F3F] print:hidden">
      {/* Logo — links home; dark surface → dark variant lockup */}
      <div className="flex h-16 items-center px-6">
        <Link href="/dashboard" aria-label="FieldSlate home" className="inline-flex">
          <FieldSlateLockup height={28} variant="dark" />
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              pathname === href ||
              (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <li key={href}>
                <Link
                  href={href}
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
  );
}
