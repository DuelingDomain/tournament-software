/** Deterministic sfc32. Both words of a safe-integer seed participate (no 32-bit seed truncation). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  let b = Math.floor(seed / 0x100000000) >>> 0;
  let c = 0x9e3779b9;
  let d = 0x243f6a88;
  const next = () => {
    const t = ((a + b | 0) + d | 0);
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / 0x100000000;
  };
  for (let i = 0; i < 16; i++) next();
  return next;
}

export function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomId(random: () => number, used: Set<string>): string {
  let id: string;
  do { id = Math.floor(random() * 0x100000000).toString(36); } while (used.has(id));
  used.add(id);
  return id;
}

