import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { CommandError } from "../types.js";

/** Keep untyped XML at the file boundary, including singleton/array variations. */
export class Element {
  constructor(private readonly value: unknown) {}

  all(name: string): Element[] {
    if (typeof this.value !== "object" || this.value === null || Array.isArray(this.value)) return [];
    const child: unknown = Reflect.get(this.value, name);
    return child === undefined ? [] : (Array.isArray(child) ? child : [child]).map(v => new Element(v));
  }

  child(name: string): Element { return this.all(name)[0] ?? new Element(undefined); }
  text(): string { return typeof this.value === "string" ? this.value.trim() : ""; }
  get(name: string): string { return this.child(name).text(); }
  has(name: string): boolean { return this.all(name).length > 0; }
  int(name: string, fallback = 0): number {
    const text = this.get(name);
    const number = Number(text);
    return text !== "" && Number.isSafeInteger(number) ? number : fallback;
  }
  bool(name: string): boolean { return /^(true|1)$/i.test(this.get(name)); }
}

export function parseXml(xml: string, root: string): Element {
  const invalid = () => new CommandError("invalid_legacy_xml", "The legacy file is not supported, well-formed XML.");
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) throw invalid();
  let parsed: unknown;
  // The parser throws on forbidden tag names and on nesting that is too deep.
  try {
    if (XMLValidator.validate(xml) !== true) throw invalid();
    parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: false }).parse(xml);
  } catch { throw invalid(); }
  const document = new Element(parsed);
  const roots = typeof parsed === "object" && parsed !== null ? Object.keys(parsed).filter(key => !key.startsWith("?")) : [];
  if (roots.length !== 1 || roots[0] !== root || document.all(root).length !== 1) throw new CommandError("invalid_legacy_xml", `The legacy file must have a single ${root} root element.`);
  return document.child(root);
}

export function buildXml(root: string, content: object): string {
  return '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLBuilder({ format: true, indentBy: "\t", suppressEmptyNode: true }).build({ [root]: content });
}
