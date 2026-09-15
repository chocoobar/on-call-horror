export const BRAND = {
  bg: "#0b0c10",
  panel: "#15171c",
  border: "#2a2d35",
  accent: "#ff4d4d",
  dim: "#9aa0a6",
  text: "#e6e6e6",
};

/** The site's mark: a terminal prompt in a dark rounded tile. Used for favicon/app icons. */
export function TerminalMark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND.bg,
        borderRadius: Math.round(size * 0.22),
        border: `${Math.max(1, Math.round(size * 0.03))}px solid ${BRAND.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
          color: BRAND.accent,
          lineHeight: 1,
        }}
      >
        {"›_"}
      </div>
    </div>
  );
}
