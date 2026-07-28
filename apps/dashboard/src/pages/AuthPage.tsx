import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import {
  loginSchema,
  mfaSchema,
  setupSchema,
  type LoginForm,
  type MFAForm,
  type SetupForm,
} from "../auth/schemas";
import { passkeysSupported } from "../auth/webauthn";
import { Brand } from "../components/Brand";
import { FormField } from "../components/FormField";
import "./AuthPage.css";

export function AuthPage({ mode }: { mode: "setup" | "login" }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedReturn = new URLSearchParams(location.search).get("returnTo");
  const returnTo =
    requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")
      ? requestedReturn
      : "/";
  useEffect(() => {
    if (auth.status?.authenticated) void navigate(returnTo, { replace: true });
    else if (auth.status && mode === "setup" && !auth.status.setupRequired)
      void navigate("/login", { replace: true });
    else if (auth.status?.setupRequired && mode === "login")
      void navigate("/setup", { replace: true });
  }, [auth.status, mode, navigate, returnTo]);

  if (auth.isLoading) return <LoadingScreen />;
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-panel__logo">
          <Brand compact />
        </div>
        {mode === "setup" ? (
          <SetupFormView />
        ) : auth.challenge ? (
          <ChallengeFormView />
        ) : (
          <LoginFormView />
        )}
      </section>
    </main>
  );
}

function SetupFormView() {
  const { setup, error, isSubmitting } = useAuth();
  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      organizationName: "",
      ownerName: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    await setup({
      organizationName: values.organizationName,
      ownerName: values.ownerName,
      username: values.username,
      password: values.password,
    });
  });
  return (
    <div className="auth-form auth-form--setup" aria-labelledby="setup-title">
      <header>
        <h1 id="setup-title">Set up Tilecast</h1>
        <p>Create the first owner account for this installation.</p>
      </header>
      {error && (
        <div className="notice notice--error" role="alert">
          {error.message}
        </div>
      )}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <FormField
          id="organizationName"
          label="Organization name"
          autoComplete="organization"
          error={form.formState.errors.organizationName?.message}
          {...form.register("organizationName")}
        />
        <FormField
          id="ownerName"
          label="Your name"
          autoComplete="name"
          error={form.formState.errors.ownerName?.message}
          {...form.register("ownerName")}
        />
        <FormField
          id="username"
          label="Email or username"
          autoComplete="username"
          error={form.formState.errors.username?.message}
          {...form.register("username")}
        />
        <div className="auth-form__passwords">
          <FormField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters"
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />
          <FormField
            id="confirmPassword"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={form.formState.errors.confirmPassword?.message}
            {...form.register("confirmPassword")}
          />
        </div>
        <button
          className="button button--primary auth-form__submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating installation…" : "Create installation"}
        </button>
      </form>
    </div>
  );
}

function LoginFormView() {
  const {
    login,
    loginWithPasskey,
    watchForPasskeyAutofill,
    error,
    isSubmitting,
    status,
  } = useAuth();
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });
  const submit = form.handleSubmit(async (values) => {
    await login(values);
  });
  const autofillReady = Boolean(status?.passkeysAvailable);
  // Autofill-assisted sign-in has to be armed early in the page's life, before
  // the user reaches the username field, or the browser has nothing to offer
  // when they focus it.
  useEffect(() => {
    if (!autofillReady) return;
    return watchForPasskeyAutofill();
    // watchForPasskeyAutofill is recreated on every render; re-arming the
    // ceremony on each one would abort the pending request the user is about
    // to answer, so this intentionally depends only on availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autofillReady]);
  // The passkey button appears only when the installation can actually run a
  // ceremony. A plain-HTTP LAN server cannot, and offering a button that
  // always fails would be worse than not offering one.
  const passkeys = Boolean(status?.passkeysAvailable) && passkeysSupported();
  return (
    <div className="auth-form" aria-labelledby="login-title">
      <header>
        <h1 id="login-title">Sign in</h1>
        <p>Manage your Tilecast displays.</p>
      </header>
      {error && (
        <div className="notice notice--error" role="alert">
          {error.message}
        </div>
      )}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <FormField
          id="username"
          label="Email or username"
          autoComplete="username webauthn"
          autoFocus
          error={form.formState.errors.username?.message}
          {...form.register("username")}
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />
        <button
          className="button button--primary auth-form__submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {passkeys && (
        <>
          <p className="auth-form__divider">or</p>
          <button
            className="button auth-form__submit"
            type="button"
            disabled={isSubmitting}
            onClick={() => void loginWithPasskey()}
          >
            Sign in with a passkey
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The second step of a password sign-in. No session cookie exists yet: the
 * challenge token in the provider is the only thing holding the attempt open.
 */
function ChallengeFormView() {
  const {
    challenge,
    verifyMfa,
    verifyMfaPasskey,
    cancelChallenge,
    error,
    isSubmitting,
  } = useAuth();
  const form = useForm<MFAForm>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: "" },
  });
  const submit = form.handleSubmit(async (values) => {
    await verifyMfa(values.code);
  });
  const canUsePasskey =
    Boolean(challenge?.methods.includes("passkey")) && passkeysSupported();
  const canUseCode = Boolean(
    challenge?.methods.includes("totp") ||
    challenge?.methods.includes("recovery_code"),
  );
  return (
    <div className="auth-form" aria-labelledby="mfa-title">
      <header>
        <h1 id="mfa-title">Two-step verification</h1>
        <p>
          {canUseCode
            ? "Enter the six-digit code from your authenticator app, or one of your recovery codes."
            : "Confirm your passkey to finish signing in."}
        </p>
      </header>
      {error && (
        <div className="notice notice--error" role="alert">
          {error.message}
        </div>
      )}
      {canUseCode && (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <FormField
            id="code"
            label="Verification code"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            error={form.formState.errors.code?.message}
            {...form.register("code")}
          />
          <button
            className="button button--primary auth-form__submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}
      {canUsePasskey && (
        <>
          {canUseCode && <p className="auth-form__divider">or</p>}
          <button
            className="button auth-form__submit"
            type="button"
            disabled={isSubmitting}
            onClick={() => void verifyMfaPasskey()}
          >
            Use a passkey
          </button>
        </>
      )}
      <button
        className="button button--quiet auth-form__cancel"
        type="button"
        onClick={cancelChallenge}
      >
        Back to sign in
      </button>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen auth-loading">
      <div className="auth-panel__logo">
        <Brand compact />
      </div>
      <span className="spinner" aria-label="Loading" />
    </div>
  );
}
