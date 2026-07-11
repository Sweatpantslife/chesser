/**
 * SlikkCredit — agency attribution badge for client sites.
 *
 * Drop-in, dependency-free, framework-agnostic React component.
 * - Brand-exact wordmark as outlined Outfit-800 paths (no font dependency).
 * - Self-contained, scoped styles (won't leak into the host, host can't break it).
 * - Zero network requests, no client JS needed — safe in React Server Components.
 *
 * Usage:
 *   import SlikkCredit from './SlikkCredit';
 *   <footer> … <SlikkCredit /> </footer>
 *
 * Props:
 *   text      — the line before the wordmark (default: "Lovingly over‑engineered by")
 *   href      — link target (default: https://slikk.dev/)
 *   className — extra class to position/space it inside your footer
 *
 * Note on SEO: the link is intentionally rel="nofollow" — a site-wide footer
 * backlink across many client domains is a link-scheme footprint that can get
 * auto-discounted or penalize slikk.dev. Keep it nofollow. (See README.)
 */
export default function SlikkCredit({
  text = 'Lovingly over‑engineered by',
  href = 'https://slikk.dev/',
  className = '',
}) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
.dsk-credit{all:revert;box-sizing:border-box;display:inline-flex;align-items:center;gap:.5em;
  font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#6b7280;
  text-decoration:none;padding:6px 2px;border:0;background:none;transition:color .18s ease}
.dsk-credit:hover,.dsk-credit:focus-visible{color:#111827}
.dsk-credit:focus-visible{outline:2px solid #FF2D6B;outline-offset:3px;border-radius:4px}
.dsk-credit__text{opacity:.9}
.dsk-credit__mark{height:15px;width:auto;display:block}
@media (prefers-reduced-motion:reduce){.dsk-credit{transition:none}}`,
        }}
      />
      <a
        className={`dsk-credit ${className}`}
        href={href}
        target="_blank"
        rel="nofollow noopener noreferrer"
        aria-label="Developed by Slikk.Dev — opens slikk.dev in a new tab"
      >
        <span className="dsk-credit__text">{text}</span>
      <svg
        className="dsk-credit__mark"
        viewBox="25 -738 3844 756"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M282 12Q193 12 134 -16Q74 -43 31 -101L167 -214Q196 -176 234 -156Q272 -135 325 -135Q370 -135 397 -151Q425 -166 430 -193Q435 -218 420 -235Q406 -251 379 -263Q352 -276 318 -287Q285 -299 254 -316Q222 -332 197 -356Q172 -380 161 -416Q151 -452 161 -505Q175 -572 217 -621Q259 -669 322 -695Q385 -720 462 -720Q539 -720 599 -695Q659 -669 692 -623L555 -510Q529 -542 500 -558Q470 -574 430 -574Q394 -574 370 -561Q346 -548 342 -524Q337 -500 352 -485Q367 -470 394 -458Q421 -447 454 -435Q487 -423 519 -407Q551 -390 576 -366Q600 -340 611 -303Q621 -265 610 -210Q589 -105 503 -47Q416 12 282 12Z M602 0 747 -729H922L776 0Z M832 0 930 -489H1104L1006 0ZM1028 -546Q989 -546 968 -572Q948 -599 956 -638Q964 -678 995 -705Q1026 -732 1066 -732Q1106 -732 1126 -705Q1146 -678 1138 -638Q1130 -599 1099 -572Q1069 -546 1028 -546Z M1376 0 1274 -256 1473 -489H1664L1422 -226L1439 -290L1576 0ZM1062 0 1208 -729H1383L1237 0Z M1894 0 1792 -256 1991 -489H2182L1940 -226L1957 -290L2094 0ZM1580 0 1726 -729H1901L1755 0Z M2459 0 2485 -128H2626Q2676 -128 2717 -147Q2757 -166 2785 -204Q2813 -241 2823 -295Q2834 -349 2821 -386Q2808 -422 2775 -442Q2743 -461 2693 -461H2545L2571 -588H2719Q2787 -588 2840 -567Q2894 -546 2928 -507Q2963 -468 2975 -414Q2988 -360 2975 -294Q2961 -228 2927 -174Q2893 -120 2843 -81Q2793 -42 2732 -21Q2670 0 2603 0ZM2359 0 2477 -588H2626L2508 0Z M3147 10Q3078 10 3031 -17Q2984 -44 2964 -93Q2944 -141 2957 -203Q2969 -264 3008 -312Q3046 -360 3102 -388Q3158 -415 3221 -415Q3283 -415 3325 -389Q3367 -363 3385 -317Q3402 -271 3391 -212Q3388 -200 3384 -187Q3381 -175 3374 -158L3015 -156L3034 -249L3335 -251L3262 -211Q3268 -245 3263 -267Q3259 -289 3244 -300Q3228 -312 3202 -312Q3175 -312 3152 -299Q3129 -286 3114 -261Q3098 -237 3091 -203Q3084 -168 3091 -144Q3098 -120 3117 -107Q3136 -95 3168 -95Q3197 -95 3222 -104Q3247 -114 3269 -135L3330 -60Q3293 -25 3246 -8Q3200 10 3147 10Z M3488 0 3404 -406H3559L3595 -64H3536L3709 -406H3862L3615 0Z"
        />
        <path
            fill="#FF2D6B"
            d="M2200 12Q2157 12 2129 -18Q2100 -47 2100 -90Q2100 -133 2129 -162Q2157 -191 2200 -191Q2244 -191 2272 -162Q2300 -133 2300 -90Q2300 -47 2272 -18Q2244 12 2200 12Z"
          />
        </svg>
      </a>
    </>
  );
}
