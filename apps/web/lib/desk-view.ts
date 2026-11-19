import type { DeskView as EngineDeskView } from "@dd-tournament/engine";

export type DeskView = EngineDeskView & { specialMemberIdsEnabled?: true };

export const MEMBER_ID_CHECK_BATCH_SIZE = 100;
