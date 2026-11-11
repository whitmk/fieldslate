// The one read of the email-problems functions (0128), for the admin pages
// (server components). Admin-only — see problems.ts.
import { parseProblems, problemsReadIsOff, type EmailProblems, type ProblemsSpec } from "./problems";

export type ProblemsRead =
  | { state: "ok"; problems: EmailProblems }
  | { state: "off" }
  | { state: "unreadable" };

type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function loadEmailProblems(
  supabase: unknown,
  spec: ProblemsSpec,
  seasonId: string,
): Promise<ProblemsRead> {
  const feature = spec.feature;
  const { data, error } = await (supabase as RpcClient).rpc(spec.rpc.read, { p_season_id: seasonId });
  if (error) {
    if (problemsReadIsOff(error.message)) return { state: "off" };
    console.error(`[email problems:${feature}] read failed:`, error.message);
    return { state: "unreadable" };
  }
  const problems = parseProblems(data, feature, spec.describe);
  if (!problems) {
    console.error(`[email problems:${feature}] malformed reply`);
    return { state: "unreadable" };
  }
  return { state: "ok", problems };
}
