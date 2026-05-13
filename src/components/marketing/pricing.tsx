import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

type Feature = { text: string; included: boolean };

const plans: {
  name: string;
  price: string;
  period: string | null;
  description: string;
  features: Feature[];
  cta: string;
  href: string;
  highlighted: boolean;
}[] = [
  {
    name: "Free",
    price: "$0",
    period: null,
    description: "One league, one sport. Great for trying it out.",
    features: [
      { text: "1 league (1 sport)", included: true },
      { text: "Up to 2 divisions", included: true },
      { text: "Up to 8 teams", included: true },
      { text: "Game schedule generator", included: true },
      { text: "PDF & CSV export", included: true },
      { text: "1 admin seat", included: true },
    ],
    cta: "Get started free",
    href: "/signup",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$159",
    period: "/yr",
    description: "Everything you need to run a full season.",
    features: [
      { text: "Unlimited divisions", included: true },
      { text: "Unlimited teams", included: true },
      { text: "Game + practice scheduling", included: true },
      { text: "Field conflict detection", included: true },
      { text: "Double-coach detection", included: true },
      { text: "Rainout rescheduler", included: true },
      { text: "2 admin seats", included: true },
    ],
    cta: "Start free trial",
    href: "/signup?plan=pro",
    highlighted: true,
  },
  {
    name: "Elite",
    price: "$349",
    period: "/yr",
    description: "Everything in Pro, plus advanced tools for bigger leagues and multi-program clubs.",
    features: [
      { text: "Multiple programs (rec + comp)", included: true },
      { text: "Interleague scheduling", included: true },
      { text: "Playoff brackets + standings", included: true },
      { text: "Umpire & referee assignments", included: true },
      { text: "Sports Connect & BYGA export", included: true },
      { text: "5 admin seats", included: true },
      { text: "Priority support", included: true },
    ],
    cta: "Start free trial",
    href: "/signup?plan=elite",
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Start free. Upgrade when you&apos;re ready. Cancel any time.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-2xl p-8 ${
                plan.highlighted
                  ? "bg-[#0C1F3F] ring-2 ring-[#22C55E]"
                  : "bg-white ring-1 ring-gray-200"
              }`}
            >
              <div className="mb-6">
                <p className={`text-sm font-semibold uppercase tracking-wide ${
                  plan.highlighted ? "text-[#22C55E]" : "text-gray-400"
                }`}>
                  {plan.name}
                </p>
                <div className="mt-3 flex items-baseline gap-0.5">
                  <span className={`text-4xl font-bold ${
                    plan.highlighted ? "text-white" : "text-[#0C1F3F]"
                  }`}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className={`text-base ${
                      plan.highlighted ? "text-white/40" : "text-gray-400"
                    }`}>
                      {plan.period}
                    </span>
                  )}
                </div>
                <p className={`mt-3 text-sm leading-relaxed ${
                  plan.highlighted ? "text-white/50" : "text-gray-500"
                }`}>
                  {plan.description}
                </p>
              </div>

              <ul className="mb-8 flex flex-col gap-2.5">
                {plan.features.map(({ text, included }) => (
                  <li key={text} className="flex items-start gap-2.5 text-sm">
                    {included ? (
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#22C55E]" />
                    ) : (
                      <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-300" />
                    )}
                    <span className={
                      !included
                        ? "text-gray-300"
                        : plan.highlighted
                        ? "text-white/70"
                        : "text-gray-600"
                    }>
                      {text}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto">
                <Link href={plan.href}>
                  <Button className={`w-full font-semibold ${
                    plan.highlighted
                      ? "bg-[#22C55E] text-white hover:bg-[#16a34a]"
                      : "bg-[#0C1F3F] text-white hover:bg-[#0C1F3F]/85"
                  }`}>
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
