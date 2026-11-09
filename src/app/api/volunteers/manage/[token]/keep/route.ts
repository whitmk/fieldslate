import { manageAction } from "@/lib/volunteers/manage-action";

// See src/lib/volunteers/manage-action.ts.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: { token: string } }) {
  return manageAction("volunteer_keep_spot", params.token, request);
}
