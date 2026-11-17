export function LogoMark({ size = 18, fill = "var(--bg-surface)" }: { size?: number; fill?: string }) {
  return <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"><rect x="4" y="1.5" width="11" height="13" rx="2" fill="none" stroke="#A78BFA" strokeWidth="1.5" /><rect x="2" y="3.5" width="11" height="13" rx="2" fill={fill} stroke="#7C3AED" strokeWidth="1.5" /></svg>;
}

export function Wordmark({ full, fill }: { full?: boolean; fill?: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <LogoMark fill={fill} /><span className="dd-display" style={{ fontSize: 15, lineHeight: 1 }}>{full ? "Dueling Domain Tournaments" : "DD Tournaments"}</span>
  </span>;
}

