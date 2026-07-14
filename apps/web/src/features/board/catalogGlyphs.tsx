import type { ObjectDockTool } from "./gestureAnnotationMode";

/**
 * Miniature shape previews for the catalog: the flyout shows the actual
 * geometry a tool will place (FigJam-style) instead of a text name. Pure
 * inline SVG — stroke follows currentColor so hover/selected states tint it.
 */
export function CatalogGlyph({ tool }: { tool: ObjectDockTool }) {
  return (
    <svg
      className="catalog-glyph"
      viewBox="0 0 40 26"
      role="presentation"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {glyphPath(tool)}
    </svg>
  );
}

function glyphPath(tool: ObjectDockTool) {
  switch (tool) {
    case "flow":
      return <rect x={5} y={5} width={30} height={16} rx={3} />;
    case "decision":
      return <path d="M20 2 L37 13 L20 24 L3 13 Z" />;
    case "terminator":
      return <rect x={4} y={6} width={32} height={14} rx={7} />;
    case "io":
      return <path d="M11 5 H37 L29 21 H3 Z" />;
    case "document":
      return <path d="M6 4 H34 V18 C27 23.5 20 14.5 13 19.5 C10.5 21.3 8 21 6 19.5 Z" />;
    case "database":
      return (
        <>
          <ellipse cx={20} cy={6.5} rx={12} ry={3.5} />
          <path d="M8 6.5 V19.5 C8 21.4 13.4 23 20 23 C26.6 23 32 21.4 32 19.5 V6.5" />
        </>
      );
    case "queue":
      return (
        <>
          <rect x={4} y={4} width={22} height={7} rx={1.5} />
          <rect x={9} y={15} width={22} height={7} rx={1.5} />
          <path d="M33 8 h4 M35 6 l2 2 -2 2" strokeWidth={1.5} />
        </>
      );
    case "user":
      return (
        <>
          <circle cx={20} cy={8} r={4.5} />
          <path d="M11 23 C11 17.5 15 15 20 15 C25 15 29 17.5 29 23" />
        </>
      );
    case "service":
      return (
        <>
          <rect x={6} y={5} width={28} height={16} rx={3} />
          <circle cx={20} cy={13} r={4} />
          <path d="M20 6.5 v2.5 M20 17 v2.5 M13.5 13 h2.5 M24 13 h2.5" strokeWidth={1.4} />
        </>
      );
    case "api":
      return (
        <>
          <rect x={4} y={5} width={32} height={16} rx={3} />
          <path d="M14 10 l-3.5 3 3.5 3 M26 10 l3.5 3 -3.5 3 M22 9 l-4 8" strokeWidth={1.5} />
        </>
      );
    case "note":
      return (
        <>
          <path d="M7 3 H33 V17 L27 23 H7 Z" />
          <path d="M33 17 H27 V23" strokeWidth={1.4} />
        </>
      );
    case "circle":
      return <ellipse cx={20} cy={13} rx={14} ry={10} />;
    case "box":
      return <rect x={6} y={5} width={28} height={16} />;
    case "highlight":
      return (
        <>
          <rect x={5} y={9} width={30} height={8} rx={2} fill="currentColor" opacity={0.28} stroke="none" />
          <path d="M5 20 h30" strokeWidth={1.4} />
        </>
      );
    case "arrow":
      return <path d="M5 19 L31 8 M31 8 l-7.5 0.5 M31 8 l-2 7" />;
    case "connector":
      return <path d="M5 6 H20 V20 H35 M31 16.5 L35 20 L31 23.5" />;
    case "select":
      return <path d="M13 3 L13 20 L18 15.5 L21.5 23 L25 21.5 L21.5 14 L28 13.5 Z" />;
    case "eraser":
      return (
        <>
          <path d="M14 20 L4.5 20 L11 13 L23 3 L33 11.5 L23.5 20 Z" />
          <path d="M11 13 L21 21" strokeWidth={1.4} />
        </>
      );
    default:
      return <rect x={6} y={5} width={28} height={16} rx={3} />;
  }
}
