import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { MEMBER_ID_LIMIT, memberIdCheckDigitOk, normalizeMemberId } from "@dd-tournament/engine";

let specialMemberIds: Float64Array | null | undefined;

function loadSpecialMemberIds(): Float64Array | null {
  const path = process.env.SPECIAL_MEMBER_IDS_PATH;
  if (!path) return null;
  try {
    const file = readFileSync(path);
    const bytes = path.toLowerCase().endsWith(".gz") ? gunzipSync(file) : file;
    if (bytes.length % 8 !== 0) throw new Error("Incomplete int64 value");

    const ids = new Float64Array(bytes.length / 8);
    for (let i = 0; i < ids.length; i++) {
      const id = Number(bytes.readBigInt64LE(i * 8));
      if (id < 0 || id >= MEMBER_ID_LIMIT) throw new Error("Member ID is out of range");
      ids[i] = id;
    }
    ids.sort();
    console.info(`Loaded ${ids.length} special member IDs.`);
    return ids;
  } catch (error) {
    console.warn((error as NodeJS.ErrnoException).code === "ENOENT"
      ? "SPECIAL_MEMBER_IDS_PATH is set, but the file is missing. Special member IDs are off."
      : "Could not load special member IDs. Ignoring the file.");
    return null;
  }
}

function getSpecialMemberIds() {
  if (specialMemberIds === undefined) specialMemberIds = loadSpecialMemberIds();
  return specialMemberIds;
}

export function hasSpecialMemberIds(): boolean {
  return (getSpecialMemberIds()?.length ?? 0) > 0;
}

export function isSpecialMemberId(id: string): boolean {
  const ids = getSpecialMemberIds();
  if (!ids?.length) return false;
  const normalized = normalizeMemberId(id);
  if (normalized === null) return false;
  const target = Number(normalized);
  let low = 0;
  let high = ids.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = ids[mid];
    if (value === target) return true;
    if (value < target) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

export function memberIdAccepted(id: string): boolean {
  return memberIdCheckDigitOk(id) || isSpecialMemberId(id);
}
