import type { PublicKeyOptions } from "../api/types";

/**
 * The WebAuthn browser API speaks ArrayBuffers while the server speaks
 * base64url JSON. These helpers translate in both directions by hand rather
 * than relying on `PublicKeyCredential.parseCreationOptionsFromJSON`, which is
 * not yet available in every browser Studio supports.
 */

function decode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    Boolean(navigator.credentials)
  );
}

/** A passkey ceremony the user dismissed is not an error worth reporting. */
export function isPasskeyCancellation(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

type CredentialDescriptorJSON = { id: string; [key: string]: unknown };

function toDescriptors(
  value: unknown,
): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return (value as CredentialDescriptorJSON[]).map((descriptor) => ({
    ...descriptor,
    id: decode(descriptor.id),
  })) as unknown as PublicKeyCredentialDescriptor[];
}

export function toCreationOptions(
  options: PublicKeyOptions,
): PublicKeyCredentialCreationOptions {
  const user = options.user as { id: string; [key: string]: unknown };
  return {
    ...options,
    challenge: decode(options.challenge as string),
    user: { ...user, id: decode(user.id) },
    excludeCredentials: toDescriptors(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
}

export function toRequestOptions(
  options: PublicKeyOptions,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: decode(options.challenge as string),
    allowCredentials: toDescriptors(options.allowCredentials),
  };
}

export function serializeRegistration(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      attestationObject: encode(response.attestationObject),
      // The server needs the transports to build an efficient allow list on
      // the next sign-in; not every authenticator reports them.
      transports: response.getTransports?.() ?? [],
    },
  };
}

export function serializeAssertion(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      authenticatorData: encode(response.authenticatorData),
      signature: encode(response.signature),
      userHandle: response.userHandle ? encode(response.userHandle) : undefined,
    },
  };
}
