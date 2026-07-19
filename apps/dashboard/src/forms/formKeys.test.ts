import { describe, expect, it } from "vitest";
import { RESERVED_FIELD_KEYS, slugifyKey, uniqueKey, validateKey } from "./formKeys";

describe("formKeys", () => {
  it("slugifies labels into valid keys", () => {
    expect(slugifyKey("Meeting title")).toBe("meeting_title");
    expect(slugifyKey("  Room #3 (Main) ")).toBe("room_3_main");
    expect(slugifyKey("123 start")).toBe("f_123_start");
    expect(slugifyKey("")).toBe("field");
  });

  it("generates unique keys avoiding existing and reserved keys", () => {
    expect(uniqueKey("Title", ["title"])).toBe("title_2");
    expect(uniqueKey("state", [])).toBe("state_2"); // reserved -> suffixed
    expect(uniqueKey("Notes", ["notes", "notes_2"])).toBe("notes_3");
  });

  it("rejects reserved keys", () => {
    for (const reserved of RESERVED_FIELD_KEYS) {
      expect(validateKey(reserved, [])).toMatch(/reserved/);
    }
  });

  it("rejects invalid and duplicate keys", () => {
    expect(validateKey("1bad", [])).toMatch(/start with a letter/);
    expect(validateKey("bad key", [])).toMatch(/start with a letter/);
    expect(validateKey("dup", ["dup"], "other")).toMatch(/already uses/);
    expect(validateKey("ok_key", ["ok_key"], "ok_key")).toBeNull(); // same field is fine
    expect(validateKey("fresh", ["other"])).toBeNull();
  });
});
