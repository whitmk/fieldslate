const steps = [
  {
    number: "01",
    title: "Set up your season",
    description:
      "Enter your season name, sport, dates, and venues. FieldSlate builds your availability calendar automatically.",
  },
  {
    number: "02",
    title: "Configure each division",
    description:
      "Set team counts, game format, rest rules, and field requirements per division. Changes to one division never affect another.",
  },
  {
    number: "03",
    title: "Generate & export",
    description:
      "Hit generate and get a full, conflict-free schedule in seconds. Export to PDF, CSV, or download a Sports Connect & BYGA formatted file — ready to upload directly to either platform.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-[#0C1F3F] py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Up and running in three steps
          </h2>
          <p className="mt-4 text-lg text-white/50">
            Most seasons publish their first schedule within 20 minutes.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
          {steps.map(({ number, title, description }, i) => (
            <div key={number} className="relative flex flex-col gap-4">
              {/* Connector line between steps */}
              {i < steps.length - 1 && (
                <div className="absolute left-[calc(100%+0.75rem)] top-5 hidden h-px w-6 bg-[#22C55E]/30 sm:block" />
              )}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10">
                  <span className="text-sm font-bold text-[#22C55E]">{number}</span>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
