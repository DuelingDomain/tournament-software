import { describe, expect, it } from "vitest";
import { isTeamId, isTemporaryMemberId, memberIdCheckDigitOk, normalizeMemberId, padMemberId } from "../../src/member-id.js";

describe("member IDs", () => {
  it.each([
    ["0012345678", "12345678"], ["12345678", "12345678"], ["00 1234-5678", "12345678"], ["0000000000", "0"],
    ["", null], ["12345678901", null], ["123a", null], ["12.34", null], ["+123", null],
  ])("normalizes %s", (input, expected) => expect(normalizeMemberId(input)).toBe(expected));

  it("pads for display and checks the weighted ten-digit form", () => {
    // 0+0+7+12+15+16+15+12+63 = 140; (11 - 140%11)%10 = 3.
    expect(padMemberId("12345673")).toBe("0012345673");
    expect(memberIdCheckDigitOk("0012345673")).toBe(true);
    expect(memberIdCheckDigitOk("12345673")).toBe(true);
    expect(memberIdCheckDigitOk("0012345678")).toBe(false);
    expect(memberIdCheckDigitOk("bad")).toBe(false);
    expect(() => padMemberId("bad")).toThrow(RangeError);
  });

  it.each([
    ["9987999999", false, false], ["9988000000", false, true], ["9998999999", false, true],
    ["9999000000", true, false], ["9999999999", true, false], ["10000000000", false, false], ["12345673", false, false],
  ])("classifies reserved ID %s", (id, temporary, team) => {
    expect(isTemporaryMemberId(id)).toBe(temporary);
    expect(isTeamId(id)).toBe(team);
  });
});
