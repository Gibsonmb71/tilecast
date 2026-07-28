// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isPasskeyCancellation,
  toCreationOptions,
  toRequestOptions,
} from "./webauthn";

// The server encodes every binary field as unpadded base64url; the browser API
// requires ArrayBuffers. A mistake here fails only inside the authenticator,
// where the error is opaque, so the conversion is tested directly.
describe("WebAuthn option decoding", () => {
  it("decodes the challenge, user handle, and exclusion list", () => {
    // "hello" and "handle!" in unpadded base64url.
    const options = toCreationOptions({
      challenge: "aGVsbG8",
      rp: { id: "signage.example.org", name: "Tilecast" },
      user: { id: "aGFuZGxlIQ", name: "owner", displayName: "Owner" },
      pubKeyCredParams: [],
      excludeCredentials: [{ id: "aGVsbG8", type: "public-key" }],
    });
    expect(new TextDecoder().decode(options.challenge as Uint8Array)).toBe(
      "hello",
    );
    expect(new TextDecoder().decode(options.user.id as Uint8Array)).toBe(
      "handle!",
    );
    expect(options.excludeCredentials).toHaveLength(1);
    expect(
      new TextDecoder().decode(
        options.excludeCredentials?.[0]?.id as Uint8Array,
      ),
    ).toBe("hello");
    // Unrelated fields must survive untouched.
    expect(options.rp.id).toBe("signage.example.org");
  });

  it("decodes base64url characters that plain base64 would reject", () => {
    // Bytes 0xFB 0xFF 0xBE encode as "-_--" only in the URL-safe alphabet.
    const options = toRequestOptions({ challenge: "-_--" });
    expect(Array.from(new Uint8Array(options.challenge as Uint8Array))).toEqual(
      [251, 255, 190],
    );
  });

  it("leaves a discoverable request without an allow list", () => {
    const options = toRequestOptions({ challenge: "aGVsbG8" });
    expect(options.allowCredentials).toBeUndefined();
  });

  it("treats a dismissed prompt as a cancellation, not a failure", () => {
    expect(
      isPasskeyCancellation(new DOMException("cancelled", "NotAllowedError")),
    ).toBe(true);
    expect(
      isPasskeyCancellation(new DOMException("aborted", "AbortError")),
    ).toBe(true);
    expect(
      isPasskeyCancellation(new DOMException("bad state", "InvalidStateError")),
    ).toBe(false);
    expect(isPasskeyCancellation(new Error("network"))).toBe(false);
  });
});
