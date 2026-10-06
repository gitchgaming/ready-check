import { describe, expect, it } from "vitest";
import { parseHourMinute } from "../../src/lib/time.js";

describe("parseHourMinute", () => {
  it.each([
    ["20:00", { hour: 20, minute: 0 }],
    ["0:00", { hour: 0, minute: 0 }],
    ["23:59", { hour: 23, minute: 59 }],
    ["7:05", { hour: 7, minute: 5 }],
  ])("parses %s", (input, expected) => {
    expect(parseHourMinute(input)).toEqual(expected);
  });

  it.each(["24:00", "12:60", "7:5", "", "noon", "20", "-1:00"])("rejects %j", (input) => {
    expect(parseHourMinute(input)).toBeNull();
  });
});
