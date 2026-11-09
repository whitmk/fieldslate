// Mutation pass for volunteer-manage-page-sim.ts — each mutant must fail
// FIRST at its own assertion (mutant-runner.ts restores every file).
import { runMutants, type Mutant } from "./mutant-runner";

const MP = "src/lib/volunteers/manage-page.ts";
const MUTANTS: Mutant[] = [
  {
    id: "MP1", what: "a malformed sign-up token passed through", file: MP,
    find: "      signupToken: typeof r.signup_token === \"string\" && /^[0-9a-f]{64}$/.test(r.signup_token) ? r.signup_token : null,",
    replace: "      signupToken: typeof r.signup_token === \"string\" ? r.signup_token : null,",
    expect: "M1",
  },
  {
    id: "MP2", what: "a moved game inside 24 hours still offers Keep / Cancel", file: MP,
    find: "  if (!c.can_change) return { kind: \"closed\", line: W.MY_CLOSED(contact), tag };\n  if (c.was_start) {",
    replace: "  if (c.was_start) {",
    expect: "M2",
  },
  {
    id: "MP3", what: "a closed cancel shown as a generic failure", file: MP,
    find: "  if (s === \"change_closed\") {",
    replace: "  if (false) {",
    expect: "M3",
  },
  {
    id: "MP4", what: "any reply counts as kept", file: MP,
    find: "  if (s === \"kept\") return { kind: \"ok\", line: W.MY_KEPT };",
    replace: "  if (s) return { kind: \"ok\", line: W.MY_KEPT };",
    expect: "M4",
  },
  {
    id: "MP5", what: "the claim id reaches the database unchecked", file: "src/lib/volunteers/manage-action.ts",
    find: "  const claimId = typeof body?.claimId === \"string\" && UUID.test(body.claimId) ? body.claimId : null;",
    replace: "  const claimId = typeof body?.claimId === \"string\" ? body.claimId : null;",
    expect: "W1",
  },
  {
    id: "MP6", what: "the private page sends its URL as a referrer", file: "src/app/v/m/[token]/page.tsx",
    find: "  referrer: \"no-referrer\",\n",
    replace: "",
    expect: "W1",
  },
];

runMutants({
  sim: "scripts/sim/volunteer-manage-page-sim.ts",
  mutants: MUTANTS,
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
});
