"use client";
import { useEffect, useState } from "react";
import { isTemporaryMemberId, memberIdCheckDigitOk } from "@dd-tournament/engine";
import { MEMBER_ID_CHECK_BATCH_SIZE } from "../../lib/desk-view";

export function useMemberIdWarnings(code: string, memberIds: (string | null)[], specialMemberIdsEnabled = false) {
  const candidates = memberIds.filter((id): id is string => id !== null && !isTemporaryMemberId(id) && !memberIdCheckDigitOk(id));
  const key = specialMemberIdsEnabled ? [...new Set(candidates)].sort().join(",") : "";
  const [checked, setChecked] = useState<{ code: string; invalidMemberIds: string[] }>();

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer: number;
    async function check(retry: boolean) {
      try {
        const ids = key.split(",");
        const batches: Promise<string[]>[] = [];
        for (let start = 0; start < ids.length; start += MEMBER_ID_CHECK_BATCH_SIZE) {
          const memberIds = ids.slice(start, start + MEMBER_ID_CHECK_BATCH_SIZE);
          batches.push(fetch(`/api/events/${encodeURIComponent(code)}/member-id-check`, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({ memberIds }),
          }).then(async response => {
            if (!response.ok) throw new Error("Member ID check failed");
            const { invalidMemberIds } = await response.json() as { invalidMemberIds: string[] };
            return invalidMemberIds;
          }));
        }
        const results = await Promise.all(batches);
        if (!controller.signal.aborted) setChecked({ code, invalidMemberIds: results.flat() });
      } catch {
        if (retry && !controller.signal.aborted) timer = window.setTimeout(() => void check(false), 1000);
      }
    }
    timer = window.setTimeout(() => void check(true), 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [code, key]);

  if (!specialMemberIdsEnabled) return new Set(candidates);
  return new Set(checked?.code === code ? checked.invalidMemberIds : []);
}
