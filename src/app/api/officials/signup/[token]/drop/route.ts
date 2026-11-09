import { officialAction } from "@/lib/officials-signup/action";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export function POST(request: Request, { params }: { params: { token: string } }) {
  return officialAction("drop", params.token, request);
}
