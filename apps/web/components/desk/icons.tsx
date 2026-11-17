export function WarnIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 L18.5 17 H1.5 Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M10 8v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="10" cy="14.5" r="1.05" fill="currentColor" /></svg>;
}
export function CheckIcon({ size = 14, color }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" style={color ? { color } : undefined}><path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}
export function RingIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}
export function DashIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7 H11" stroke="currentColor" strokeWidth="2" /></svg>;
}
