import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import { api } from "../api/client";
import type {
  AuthStatus,
  LoginInput,
  MFAChallenge,
  SessionResult,
  SetupInput,
} from "../api/types";
import {
  isPasskeyCancellation,
  serializeAssertion,
  toRequestOptions,
} from "./webauthn";

type AuthContextValue = {
  status?: AuthStatus;
  isLoading: boolean;
  error: Error | null;
  /** Set when a password was accepted but a second factor is still owed. */
  challenge?: MFAChallenge;
  setup: (input: SetupInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  /** Completes a pending challenge with the account's passkey. */
  verifyMfaPasskey: () => Promise<void>;
  /** Signs in with a discoverable passkey, with no username or password. */
  loginWithPasskey: () => Promise<void>;
  cancelChallenge: () => void;
  logout: () => Promise<void>;
  isSubmitting: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const authKey = ["auth", "status"] as const;

/**
 * Every failure here is already surfaced through `error` on the context, so
 * the promise these helpers return resolves either way. Rejecting as well
 * would make each caller repeat the same catch to avoid an unhandled
 * rejection, and a wrong password is an expected outcome, not a fault.
 */
async function settle(work: Promise<unknown>) {
  await work.catch(() => undefined);
}

function isChallenge(
  result: MFAChallenge | SessionResult,
): result is MFAChallenge {
  return "mfaRequired" in result && result.mfaRequired;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [challenge, setChallenge] = useState<MFAChallenge | undefined>();
  const query = useQuery({
    queryKey: authKey,
    queryFn: api.authStatus,
    retry: false,
    staleTime: 30_000,
  });
  const setSession = (result: SessionResult) => {
    setChallenge(undefined);
    queryClient.setQueryData<AuthStatus>(authKey, {
      ...(query.data ?? { setupRequired: false }),
      setupRequired: false,
      authenticated: true,
      ...result,
    });
  };
  const setupMutation = useMutation({
    mutationFn: api.setup,
    onSuccess: setSession,
  });
  const loginMutation = useMutation({
    mutationFn: api.login,
    onSuccess: (result) => {
      if (isChallenge(result)) setChallenge(result);
      else setSession(result);
    },
  });
  const verifyMutation = useMutation({
    mutationFn: (code: string) => {
      if (!challenge) throw new Error("This sign-in attempt has expired.");
      return api.verifyMfa(challenge.challengeToken, code);
    },
    onSuccess: setSession,
  });
  // The passkey mutations own the whole ceremony: the browser call sits
  // between two requests, so it cannot be split across React state.
  const passkeyChallengeMutation = useMutation({
    mutationFn: async () => {
      if (!challenge) throw new Error("This sign-in attempt has expired.");
      const ceremony = await api.mfaPasskeyOptions(challenge.challengeToken);
      const credential = (await navigator.credentials.get({
        publicKey: toRequestOptions(ceremony.options),
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was provided.");
      return api.passkeyLogin(
        ceremony.challengeToken,
        serializeAssertion(credential),
      );
    },
    onSuccess: setSession,
  });
  const passkeyLoginMutation = useMutation({
    mutationFn: async () => {
      const ceremony = await api.passkeyLoginOptions();
      const credential = (await navigator.credentials.get({
        publicKey: toRequestOptions(ceremony.options),
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was provided.");
      return api.passkeyLogin(
        ceremony.challengeToken,
        serializeAssertion(credential),
      );
    },
    onSuccess: setSession,
  });
  const logoutMutation = useMutation({
    mutationFn: async () => api.logout(query.data?.csrfToken ?? ""),
    onSuccess: () => {
      setChallenge(undefined);
      queryClient.setQueryData<AuthStatus>(authKey, {
        ...(query.data ?? { setupRequired: false }),
        setupRequired: false,
        authenticated: false,
        user: undefined,
        csrfToken: undefined,
        mfaEnrollmentRequired: false,
      });
    },
  });

  const passkeyError =
    passkeyChallengeMutation.error ?? passkeyLoginMutation.error;
  const mutationError =
    setupMutation.error ??
    loginMutation.error ??
    verifyMutation.error ??
    // A dismissed system passkey prompt is a normal outcome, not a failure to
    // report back to the user.
    (isPasskeyCancellation(passkeyError) ? null : passkeyError) ??
    logoutMutation.error;
  return (
    <AuthContext.Provider
      value={{
        status: query.data,
        isLoading: query.isLoading,
        error: query.error ?? mutationError,
        challenge,
        setup: (input) => settle(setupMutation.mutateAsync(input)),
        login: (input) => settle(loginMutation.mutateAsync(input)),
        verifyMfa: (code) => settle(verifyMutation.mutateAsync(code)),
        verifyMfaPasskey: () => settle(passkeyChallengeMutation.mutateAsync()),
        loginWithPasskey: () => settle(passkeyLoginMutation.mutateAsync()),
        cancelChallenge: () => setChallenge(undefined),
        logout: () => settle(logoutMutation.mutateAsync()),
        isSubmitting:
          setupMutation.isPending ||
          loginMutation.isPending ||
          verifyMutation.isPending ||
          passkeyChallengeMutation.isPending ||
          passkeyLoginMutation.isPending ||
          logoutMutation.isPending,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
