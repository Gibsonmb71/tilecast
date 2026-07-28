import { describe, expect, it } from "vitest";
import {
  formatPresentationValue,
  selectTemporalRecords,
} from "./SourceEditors";

const now = new Date("2026-08-24T13:30:00Z");
const records = [
  {
    id: "algebra",
    start: "2026-08-24T13:00:00Z",
    end: "2026-08-24T14:00:00Z",
  },
  {
    id: "science",
    start: "2026-08-24T14:10:00Z",
    end: "2026-08-24T15:00:00Z",
  },
  {
    id: "art",
    start: "2026-08-24T15:10:00Z",
    end: "2026-08-24T16:00:00Z",
  },
];

describe("temporal presentation preview", () => {
  it("selects current and future records using preview time", () => {
    expect(
      selectTemporalRecords(records, now, "current", "start", "end").map(
        (record) => record.id,
      ),
    ).toEqual(["algebra"]);
    expect(
      selectTemporalRecords(records, now, "next", "start", "end").map(
        (record) => record.id,
      ),
    ).toEqual(["science"]);
    expect(
      selectTemporalRecords(records, now, "upcoming", "start", "end").map(
        (record) => record.id,
      ),
    ).toEqual(["science", "art"]);
  });

  it("uses the same compact countdown wording as the Player", () => {
    expect(
      formatPresentationValue(
        "2026-08-24T14:10:00Z",
        { source: "repeat", format: "relative-countdown" },
        now,
      ),
    ).toBe("40m 0s");
  });
});
