"use client";

import { useState } from "react";
import { Play } from "lucide-react";

// Click-to-play facade: no YouTube resource of any kind loads until the user
// clicks the poster. Known accepted limitation: iOS Safari may require a
// second tap to start playback despite autoplay=1 in the injected iframe.
// No <form> in here, ever — this may get reused inside hosts that have one.
export function HeroVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative mx-auto mt-14 aspect-video w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 sm:mt-16">
      {playing ? (
        <iframe
          src="https://www.youtube-nocookie.com/embed/yKggoZaAHYo?autoplay=1&playsinline=1"
          title="FieldSlate promo video"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image is unused project-wide; static assets are served directly */}
          <img
            src="/promo-poster.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <button
            type="button"
            aria-label="Play video"
            onClick={() => setPlaying(true)}
            className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#22C55E] shadow-lg">
              <Play className="ml-1 h-7 w-7 fill-white text-white" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}
