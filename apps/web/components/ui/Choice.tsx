import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

type ChoiceProps = Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode; touch?: boolean };

function Choice({ kind, label, hint, touch, className, disabled, ...rest }: ChoiceProps & { kind: "checkbox" | "radio" }) {
  return <label className={cx("dd-opt", touch && "dd-opt--touch", className)} data-disabled={disabled ? "true" : undefined}>
    <input type={kind} className={kind === "checkbox" ? "dd-chk" : "dd-rad"} disabled={disabled} {...rest} />
    <span>{label}{hint && <span className="dd-hint"> {hint}</span>}</span>
  </label>;
}
export function Checkbox(props: ChoiceProps) { return <Choice kind="checkbox" {...props} />; }
export function Radio(props: ChoiceProps) { return <Choice kind="radio" {...props} />; }
