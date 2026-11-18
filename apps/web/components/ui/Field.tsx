import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export function Input({ className, mono, slot, ...rest }: ComponentProps<"input"> & { mono?: boolean; slot?: boolean }) {
  return <input className={cx("dd-input", mono && "dd-input--mono", slot && "dd-input--slot", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx("dd-input", "dd-textarea", className)} {...rest} />;
}

export function Select({ className, compact, children, ...rest }: ComponentProps<"select"> & { compact?: boolean }) {
  return <select className={cx("dd-select", compact && "dd-select--sm", className)} {...rest}>{children}</select>;
}

/** Label + control + optional hint/error. Wraps the control in a <label> so it is always named. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cx("dd-field", className)}>
    <span className="dd-caps">{label}</span>
    {children}
    {hint && <span className="dd-hint">{hint}</span>}
    {error && <span className="dd-error" role="alert">{error}</span>}
  </label>;
}
