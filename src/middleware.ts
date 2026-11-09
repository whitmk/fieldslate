import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// /s/… (the public league schedule, its data and its .ics feed) is left out:
// anonymous and often embedded, so a session refresh — a Supabase Auth call on
// every request — would be pure cost on its busiest path.
// /v/… (the volunteer sign-up and manage pages, 0121) is left out for the same
// reason: anonymous, token-addressed, never signed in.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|s/|v/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
