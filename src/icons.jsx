// Small stroke-icon set (Lucide-style, 24px grid). Purely presentational —
// replaces the emoji / unicode glyphs that used to sit inside buttons.
const Svg = ({ size = 16, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="ico"
    {...rest}
  >
    {children}
  </svg>
);

export const IconCheck = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const IconX = (p) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const IconPlay = (p) => <Svg {...p}><path d="M6 4l14 8-14 8z" /></Svg>;
export const IconStop = (p) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
export const IconBolt = (p) => <Svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Svg>;
export const IconSpark = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
  </Svg>
);
export const IconRefresh = (p) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
    <path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
);
export const IconPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconArrowLeft = (p) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
export const IconDownload = (p) => (
  <Svg {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Svg>
);
export const IconEdit = (p) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);
export const IconFile = (p) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);
export const IconCode = (p) => <Svg {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></Svg>;
export const IconTarget = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </Svg>
);
export const IconBox = (p) => (
  <Svg {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </Svg>
);
export const IconPlayCircle = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" /></Svg>
);
export const IconSheet = (p) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M4 9h16M4 15h16M10 3v18" />
  </Svg>
);
export const IconImage = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-9 9" />
  </Svg>
);
export const IconSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const IconChevronRight = (p) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconChevronDown = (p) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconMaximize = (p) => <Svg {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>;
export const IconMinimize = (p) => <Svg {...p}><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></Svg>;
export const IconClock = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);
export const IconLayers = (p) => (
  <Svg {...p}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></Svg>
);
export const IconAlert = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);