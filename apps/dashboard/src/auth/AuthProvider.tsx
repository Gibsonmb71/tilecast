import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type PropsWithChildren } from "react";
import { api } from "../api/client";
import type { AuthStatus, LoginInput, SetupInput } from "../api/types";

type AuthContextValue = {
  status?: AuthStatus;
  isLoading: boolean;
  error: Error | null;
  setup: (input: SetupInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  isSubmitting: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const authKey = ["auth", "status"] as const;

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: authKey,
    queryFn: api.authStatus,
    retry: false,
    staleTime: 30_000,
  });
  const setSession = (result: {
    user: NonNullable<AuthStatus["user"]>;
    csrfToken: string;
  }) => {
    queryClient.setQueryData<AuthStatus>(authKey, {
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
    onSuccess: setSession,
  });
  const logoutMutation = useMutation({
    mutationFn: async () => api.logout(query.data?.csrfToken ?? ""),
    onSuccess: () =>
      queryClient.setQueryData<AuthStatus>(authKey, {
        setupRequired: false,
        authenticated: false,
      }),
  });

  const mutationError =
    setupMutation.error ?? loginMutation.error ?? logoutMutation.error;
  return (
    <AuthContext.Provider
      value={{
        status: query.data,
        isLoading: query.isLoading,
        error: query.error ?? mutationError,
        setup: async (input) => void (await setupMutation.mutateAsync(input)),
        login: async (input) => void (await loginMutation.mutateAsync(input)),
        logout: async () => void (await logoutMutation.mutateAsync()),
        isSubmitting:
          setupMutation.isPending ||
          loginMutation.isPending ||
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
