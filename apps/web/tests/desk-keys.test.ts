import { describe, expect, it } from "vitest";
import { actionForKey } from "../components/desk/actions";

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => actionForKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent);

describe("desk key map", () => {
  it("maps the function keys", () => {
    expect(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"].map(k => key(k))).toEqual([
      "go-players", "go-pairings", "go-standings", "print-players", "print-pairings", "print-brackets", "print-slips", "print-standings", "pair", "repair", "cut", "cancel",
    ]);
  });
  it("maps the Ctrl shortcuts, and Cmd works too", () => {
    const ids = { f: "find", k: "notes", m: "history", p: "print-batch", s: "save", o: "open", ".": "palette" };
    for (const [k, id] of Object.entries(ids)) { expect(key(k, { ctrlKey: true })).toBe(id); expect(key(k, { metaKey: true })).toBe(id); }
  });
  it("leaves browser-reserved and unrelated keys alone", () => {
    expect(key("n", { ctrlKey: true })).toBeNull();
    expect(key("w", { ctrlKey: true })).toBeNull();
    expect(key("p")).toBeNull();
    expect(key("F5", { shiftKey: true })).toBeNull();
    expect(key("-")).toBeNull();
  });
});
