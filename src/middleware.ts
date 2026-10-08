import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// /s/… (the public league schedule, its data and its .ics feed) is left out:
// anonymous and often embedded, so a session refresh — a Supabase Auth call on
// every request — would be pure cost on its busiest path.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|s/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
