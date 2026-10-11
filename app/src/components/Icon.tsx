/**
 * The app's icons: one outline style (2px rounded strokes on a 24px grid) so they sit together.
 * They take the colour and size of the text around them unless a class says otherwise.
 */
const PATHS = {
  users: ["M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1", "M9.5 11a3.5 3.5 0 1 0 0-7 3.500 3.500 0 0 0 0 7z", "M21 20v-1a4 4 0 0 0-3-3.850", "M15.500 4.200a3.500 3.500 0 0 1 0 6.600"],
  userPlus: ["M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1", "M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7z", "M19 8v6", "M16 11h6"],
  chat: ["M4 5h16a1.500 1.500 0 0 1 1.500 1.500v9A1.500 1.500 0 0 1 20 17h-8l-5 4v-4H4a1.500 1.500 0 0 1-1.500-1.500v-9A1.500 1.500 0 0 1 4 5z"],
  video: ["M3 7.500A1.500 1.500 0 0 1 4.500 6h9A1.500 1.500 0 0 1 15 7.500v9a1.500 1.500 0 0 1-1.500 1.500h-9A1.500 1.500 0 0 1 3 16.500z", "m15 10.500 6-3.500v10l-6-3.500"],
  clipboard: ["M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z", "M8 5H6.500A1.500 1.500 0 0 0 5 6.500v13A1.500 1.500 0 0 0 6.500 21h11a1.500 1.500 0 0 0 1.500-1.500v-13A1.500 1.500 0 0 0 17.500 5H16", "m9 14 2 2 4-4"],
  school: ["m2 9 10-5 10 5-10 5z", "M6 11.500V16c0 1.500 2.700 3 6 3s6-1.500 6-3v-4.500", "M22 9v5"],
  flag: ["M5 21V4", "M5 4h12l-2 4 2 4H5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  check: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "m8.500 12 2.500 2.500 4.500-5"],
  target: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 12h.010"],
  alert: ["M12 4 2.500 20h19z", "M12 10v4", "M12 17h.010"],
  plus: ["M12 5v14", "M5 12h14"],
  arrowRight: ["M5 12h14", "m13 6 6 6-6 6"],
  arrowLeft: ["M19 12H5", "m11 6-6 6 6 6"],
  chart: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  logout: ["M9 4H6.500A1.500 1.500 0 0 0 5 5.500v13A1.500 1.500 0 0 0 6.500 20H9", "M14 8l4 4-4 4", "M18 12H9"],
  pulse: ["M3 12h4l2.500-6 4 12 2.500-6h5"],
  mood: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8.500 14.500c1 1.200 2.200 1.800 3.500 1.800s2.500-.600 3.500-1.800", "M9 10h.010", "M15 10h.010"],
  lock: ["M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z", "M8 11V8a4 4 0 0 1 8 0v3"],
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, className = "h-[1.15em] w-[1.15em]" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`flex-none ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
