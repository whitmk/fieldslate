import { Plus } from "lucide-react";
import { HOME_FAQ } from "@/lib/marketing/home-faq";

// Homepage "Frequently asked questions". Text comes ONLY from HOME_FAQ
// (src/lib/marketing/home-faq.ts), the same list the FAQPage JSON-LD is built
// from — never type a question or answer here.
//
// Native <details>/<summary>: no JavaScript, every answer is in the HTML, all
// closed by default. The + turns into × (rotated 45°) when an item is open.
// The default disclosure triangle is hidden (list-none + the webkit marker
// rule) so the icon is the only indicator. Server component; homepage hex
// literals like its neighbors.
export function Faq() {
  return (
    <section id="faq" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
          Frequently asked questions
        </h2>

        <div className="mt-12 flex flex-col gap-3">
          {HOME_FAQ.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-2xl bg-white ring-1 ring-gray-200 open:ring-[#0C1F3F]/20"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-2xl px-5 py-4 text-left text-base font-semibold text-[#0C1F3F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] focus-visible:ring-offset-2 sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
                <span>{question}</span>
                <Plus
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#16a34a] transition-transform group-open:rotate-45"
                />
              </summary>
              <p className="px-5 pb-5 text-base leading-relaxed text-gray-600 sm:px-6">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
