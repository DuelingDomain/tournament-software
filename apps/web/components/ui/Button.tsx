import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { Keycap } from "./Keycap";

export type ButtonVariant = "default" | "rose" | "rose-outline" | "violet" | "ghost" | "link";
type Common = { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; block?: boolean; keyHint?: string; children?: ReactNode };

function classes({ variant = "default", size = "md", block, className }: Common & { className?: string }) {
  return cx("dd-btn", variant !== "default" && `dd-btn--${variant}`, size !== "md" && `dd-btn--${size}`, block && "dd-btn--block", className);
}

export function Button({ variant, size, block, keyHint, children, className, type = "button", ...rest }: Common & ComponentProps<"button">) {
  return <button type={type} className={classes({ variant, size, block, className })} {...rest}>
    {children}{keyHint && <Keycap>{keyHint}</Keycap>}
  </button>;
}

/** Same look as Button, rendered as a link. */
export function ButtonLink({ variant, size, block, keyHint, children, className, ...rest }: Common & ComponentProps<"a">) {
  return <a className={classes({ variant, size, block, className })} {...rest}>{children}{keyHint && <Keycap>{keyHint}</Keycap>}</a>;
}
