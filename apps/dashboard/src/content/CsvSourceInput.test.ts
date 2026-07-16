import { describe, expect, it } from "vitest";
import { inspectCsv } from "./CsvSourceInput";

describe("inspectCsv", () => {
  it("detects comma-separated columns and data rows", () => {
    expect(inspectCsv("title,room,date\nLunch,Cafe,2026-07-16\n")).toEqual({
      columns: ["title", "room", "date"],
      delimiter: ",",
      rowCount: 1,
    });
  });

  it("supports quoted headers and alternate delimiters", () => {
    expect(inspectCsv('"Item; name";Location;Price\nCoffee;Lobby;$2')).toEqual({
      columns: ["Item; name", "Location", "Price"],
      delimiter: ";",
      rowCount: 1,
    });
  });

  it("strips a UTF-8 byte order mark and ignores blank rows", () => {
    expect(inspectCsv("\uFEFFname\tvalue\nOne\t1\n\n")).toEqual({
      columns: ["name", "value"],
      delimiter: "\t",
      rowCount: 1,
    });
  });
});
