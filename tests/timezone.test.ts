import { describe, expect, it } from "vitest";
import { isValidTimeZone, localDayStart, zonedMinuteToInstant } from "@/lib/utils";

describe("clinic time zones", () => {
  it("turns a clinic's 9am into the right instant", () => {
    const day = new Date("2026-10-17T00:00:00Z");
    // Cairo is UTC+3 on this date, so 09:00 there is 06:00Z.
    expect(zonedMinuteToInstant(day, 9 * 60, "Africa/Cairo").toISOString()).toBe(
      "2026-10-17T06:00:00.000Z",
    );
    expect(zonedMinuteToInstant(day, 9 * 60, "UTC").toISOString()).toBe("2026-10-17T09:00:00.000Z");
  });

  it("follows daylight saving", () => {
    // London switches to BST at 01:00 UTC on 29 March 2026.
    const day = new Date("2026-03-29T00:00:00Z");
    expect(zonedMinuteToInstant(day, 9 * 60, "Europe/London").toISOString()).toBe(
      "2026-03-29T08:00:00.000Z",
    );
  });

  it("reads the calendar day in the clinic's zone, not UTC's", () => {
    // 21:30Z is already the next morning in Cairo.
    expect(localDayStart(new Date("2026-10-16T21:30:00Z"), "Africa/Cairo").toISOString()).toBe(
      "2026-10-17T00:00:00.000Z",
    );
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Africa/Cairo")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
