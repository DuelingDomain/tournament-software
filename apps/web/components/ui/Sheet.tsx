import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** A sheet: a panel on the mat. */
export function Sheet({ as: Tag = "section", className, children, ...rest }: { as?: ElementType; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return <Tag className={cx("dd-sheet", className)} {...rest}>{children}</Tag>;
}

/** A slip: a row or card lifted off the sheet. `lift` adds the selected shadow, `card` the large phone card. */
export function Slip({ as: Tag = "div", lift, card, className, children, ...rest }: { as?: ElementType; lift?: boolean; card?: boolean; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return <Tag className={cx("dd-slip", lift && "dd-slip--lift", card && "dd-slip--card", className)} {...rest}>{children}</Tag>;
}

/** Dotted perforation with two notches; extends to the slip edges (negative margin matches 20px padding). */
export function Perforation({ className }: { className?: string }) {
  return <div className={cx("dd-perf", className)} aria-hidden="true" />;
}
