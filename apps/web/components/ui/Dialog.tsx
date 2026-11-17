"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";

/**
 * In-page modal on the native <dialog> element: focus is trapped, Esc closes, focus returns to the opener.
 * Never use window.confirm. Desk key handlers should ignore keys while `document.querySelector("dialog[open]")` exists.
 */
export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="dd-dialog" aria-labelledby={titleId} onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}>
    {open && <div className="dd-dialog__body">
      <h2 id={titleId} className="dd-dialog__title">{title}</h2>
      {children}
      <div className="dd-dialog__actions">{actions}</div>
    </div>}
  </dialog>;
}

/** Confirm/cancel dialog. The confirm button is focused first only when not destructive. */
export function ConfirmDialog({ open, title, message, confirmLabel, confirmVariant = "rose", busy, onConfirm, onCancel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; confirmVariant?: ButtonVariant; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return <Dialog open={open} onClose={onCancel} title={title} actions={<>
    <Button onClick={onCancel} autoFocus>Cancel</Button>
    <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
  </>}>
    <div style={{ color: "var(--text-3)" }}>{message}</div>
  </Dialog>;
}
