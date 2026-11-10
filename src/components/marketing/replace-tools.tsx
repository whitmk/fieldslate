// Homepage band near Pricing: the tools a board juggles today and what
// replaces them, without knocking any of them (positioning doc 2026-11-10).
// Registration and payments stay with the league's platform — never imply
// FieldSlate takes them.
//
// White with a top rule: it sits between Compare (white) and Pricing
// (gray-50). The "Today / In FieldSlate" list is a real table for screen
// readers; below sm it stacks as label pairs.

const ROWS: { today: string; fieldslate: string }[] = [
  { today: "Scheduling spreadsheet", fieldslate: "Season scheduler with field-conflict checks" },
  { today: "Separate volunteer sign-up system", fieldslate: "Built-in sign-ups tied to each game" },
  {
    today: "Umpire group chat or separate umpire system",
    fieldslate: "Auto-assign plus officials' own pick list",
  },
  {
    today: "Snack shack in the sign-up system or a spreadsheet",
    fieldslate: "Shifts built from the game schedule",
  },
];

export function ReplaceTools() {
  return (
    <section id="replace-tools" className="border-t border-gray-100 bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Replace the pile of tools. Keep your registration.
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Most boards run the season on a scheduling spreadsheet, a separate sign-up system for
            volunteers and snack shack (or another spreadsheet), and a group chat or separate system
            for umpires. FieldSlate puts all of it in one system that stays in sync. Registration
            and payments stay with the platform your league already uses, like PlayMetrics or
            Sports Connect.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-gray-100">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <th scope="col" className="w-1/2 px-3 py-3 sm:px-5">
                  Today
                </th>
                <th scope="col" className="w-1/2 px-3 py-3 text-[#0C1F3F] sm:px-5">
                  In FieldSlate
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ today, fieldslate }) => (
                <tr key={today} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-3 leading-snug text-gray-500 sm:px-5">{today}</td>
                  <td className="px-3 py-3 font-medium leading-snug text-[#0C1F3F] sm:px-5">
                    {fieldslate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
