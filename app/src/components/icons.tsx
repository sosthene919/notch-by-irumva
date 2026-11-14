/**
 * One icon set for the island (brief section 3): 24px grid, 1.8 stroke,
 * round caps, no fills except the play/pause glyphs. Never mixed with
 * emoji or text symbols.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, 'aria-hidden': true, ...props,
});

export const IconPlay = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
);
export const IconNext = (p: P) => (
  <svg {...base(p)}><path d="M6 6l8 6-8 6z" fill="currentColor" stroke="none" /><path d="M17 5v14" /></svg>
);
export const IconPrev = (p: P) => (
  <svg {...base(p)}><path d="M18 6l-8 6 8 6z" fill="currentColor" stroke="none" /><path d="M7 5v14" /></svg>
);
export const IconPlus = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconCheck = (p: P) => (<svg {...base(p)}><path d="M4.5 12.5 10 18 19.5 6.5" /></svg>);
export const IconX = (p: P) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const IconDrop = (p: P) => (
  <svg {...base(p)}><path d="M12 3.5c3.2 3.9 6 7.3 6 10.2a6 6 0 1 1-12 0C6 10.8 8.8 7.4 12 3.5z" /></svg>
);
export const IconFile = (p: P) => (
  <svg {...base(p)}><path d="M6 3.5h8L19 8v12.5H6z" /><path d="M13.5 3.5V8.5H19" /></svg>
);
export const IconMusic = (p: P) => (
  <svg {...base(p)}><path d="M9 18.5V6l10-2v12" /><circle cx="6.5" cy="18.5" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>
);
export const IconLyrics = (p: P) => (
  <svg {...base(p)}><path d="M5 6h14M5 11h9M5 16h12" /></svg>
);
export const IconShuffle = (p: P) => (
  <svg {...base(p)}><path d="M3 7h4l10 10h4m0 0-3-3m3 3-3 3M3 17h4l2.5-2.5M13.5 9.5 17 7h4m0 0-3-3m3 3-3 3" /></svg>
);
export const IconRepeat = (p: P) => (
  <svg {...base(p)}><path d="M17 2.5 21 6l-4 3.5" /><path d="M3 12.5v-1A2.5 2.5 0 0 1 5.5 9H21M7 21.5 3 18l4-3.5" /><path d="M21 11.5v1a2.5 2.5 0 0 1-2.5 2.5H3" /></svg>
);
export const IconBluetooth = (p: P) => (
  <svg {...base(p)}><path d="m7 8 10 8-5 4V4l5 4L7 16" /></svg>
);
export const IconHeadphones = (p: P) => (
  <svg {...base(p)}><path d="M4 16v-3a8 8 0 0 1 16 0v3" /><path d="M4 16a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2zM20 16a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2z" /></svg>
);
export const IconEarbuds = (p: P) => (
  <svg {...base(p)}><path d="M7 4a3 3 0 0 1 3 3v4a3 3 0 1 1-3-3zM7 14v3a4 4 0 0 0 4 4" /><path d="M17 4a3 3 0 0 0-3 3v4a3 3 0 1 0 3-3zM17 14v3a4 4 0 0 1-4 4" /></svg>
);
export const IconMouse = (p: P) => (
  <svg {...base(p)}><rect x="7" y="3" width="10" height="18" rx="5" /><path d="M12 7v4" /></svg>
);
export const IconKeyboard = (p: P) => (
  <svg {...base(p)}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h.01M17 14h.01M10 14h4" /></svg>
);
export const IconSpeaker = (p: P) => (
  <svg {...base(p)}><rect x="6" y="3" width="12" height="18" rx="2" /><circle cx="12" cy="14" r="3" /><path d="M12 7h.01" /></svg>
);
/* 1.1.0 design set: status strip + Pomodoro/TodoList/Music artwork.
   Same 24px grid and stroke rules as the set above. */
export const IconBolt = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M13 2 4.5 13.5H11L9.8 22 19 9.8h-6.5z" /></svg>
);
export const IconBell = (p: P) => (
  <svg {...base(p)}><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 3h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
);
export const IconTimer = (p: P) => (
  <svg {...base(p)}><path d="M9.5 2.5h5" /><path d="M12 2.5V6" /><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l3 2" /></svg>
);
export const IconCoffee = (p: P) => (
  <svg {...base(p)}><path d="M4 9h13v5a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M7 5.5c0-1 .8-1 .8-2M11 5.5c0-1 .8-1 .8-2" /></svg>
);
export const IconTarget = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
);
export const IconCalendar = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="5" width="17" height="16" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const IconEdit = (p: P) => (
  <svg {...base(p)}><path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17z" /><path d="m13.5 6.5 3 3" /></svg>
);
export const IconVolume = (p: P) => (
  <svg {...base(p)}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></svg>
);
/* 1.1.5 Boring-style set: settings gear, file tray, muted speaker. */
export const IconGear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
  </svg>
);
export const IconTray = (p: P) => (
  <svg {...base(p)}><path d="M3.5 13.5 5.6 5h12.8l1.9 8.5" /><path d="M3 13.5h5l1.2 2h5.6l1.2-2h5v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const IconMuted = (p: P) => (
  <svg {...base(p)}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none" /><path d="m16 9.5 5 5m0-5-5 5" /></svg>
);
export const IconReset = (p: P) => (
  <svg {...base(p)}><path d="M3.5 8.5A9 9 0 1 1 3 13.5" /><path d="M3 3.5v5h5" /></svg>
);
