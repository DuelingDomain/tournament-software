import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/** Small inline key hint, e.g. <Keycap>F9</Keycap>. Decorative text, read by screen readers as the key. */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("dd-keycap", className)}>{children}</kbd>;
}

/** Large physical keycap button (the - + * / keys beside the Table slot). `down` shows the pressed state. */
export function BigKeycap({ keyLabel, caption, down, className, ...rest }: {
  keyLabel: string; caption: string; down?: boolean;
} & Omit<ComponentProps<"button">, "children">) {
  return <button type="button" className={cx("dd-keycap", "dd-keycap--big", className)} data-down={down ? "true" : undefined} {...rest}>
    <span aria-hidden="true">{keyLabel}</span><small>{caption}</small>
  </button>;
}
