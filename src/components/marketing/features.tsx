import { SlidersHorizontal, ShieldCheck, Users, ArrowLeftRight } from "lucide-react";

const features = [
  {
    icon: SlidersHorizontal,
    title: "Per-division parameters",
    description:
      "Set game lengths, rest days, max games per week, and field requirements independently for each division. U10 and varsity can coexist without conflict.",
    tag: null,
  },
  {
    icon: ShieldCheck,
    title: "Field conflict prevention",
    description:
      "FieldSlate checks every game against your venue availability calendar before it's placed. No more discovering double-bookings the night before.",
    tag: null,
  },
  {
    icon: Users,
    title: "Double-coach detection",
    description:
      "Automatically flags when a coach is assigned to overlapping games across divisions. Catch scheduling conflicts before they become phone calls.",
    tag: "Only on FieldSlate",
  },
  {
    icon: ArrowLeftRight,
    title: "Interleague scheduling",
    description:
      "Run shared schedules across multiple leagues or organizations. Perfect for travel teams, all-star events, and cross-division playoffs.",
    tag: null,
  },
];

export function Features() {
  return (
    <section id="features" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Built for how leagues actually work
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Every feature was designed around the real problems league admins face every spring.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, description, tag }) => (
            <div
              key={title}
              className="relative flex flex-col gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-7"
            >
              {tag && (
                <span className="absolute right-5 top-5 rounded-full bg-[#22C55E]/10 px-2.5 py-0.5 text-xs font-semibold text-[#22C55E]">
                  {tag}
                </span>
              )}
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#0C1F3F]">
                <Icon className="h-5 w-5 text-[#22C55E]" />
              </div>
              <div>
                <h3 className="font-semibold text-[#0C1F3F]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
