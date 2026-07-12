import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import {
  loginSchema,
  setupSchema,
  type LoginForm,
  type SetupForm,
} from "../auth/schemas";
import { Brand } from "../components/Brand";
import { FormField } from "../components/FormField";

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
    <div className="auth-page">
      <aside className="auth-context">
        <Brand />
        <div>
          <p className="eyebrow">Open signage infrastructure</p>
          <h1>Built to keep the message on.</h1>
          <p>
            Run your own signage service, keep control of your content, and stay
            operational through network interruptions.
          </p>
        </div>
        <p className="auth-context__foot">Tilecast · AGPLv3</p>
      </aside>
      <main className="auth-main">
        {mode === "setup" ? <SetupFormView /> : <LoginFormView />}
      </main>
    </div>
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
    <section className="auth-card" aria-labelledby="setup-title">
      <header>
        <p className="step-label">Initial setup</p>
        <h2 id="setup-title">Create your Tilecast installation</h2>
        <p>
          This owner account has full administrative access. More users can be
          added later.
        </p>
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
        <div className="form-grid">
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
          className="button button--primary"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating installation…" : "Create installation"}
        </button>
      </form>
    </section>
  );
}

function LoginFormView() {
  const { login, error, isSubmitting } = useAuth();
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });
  const submit = form.handleSubmit(async (values) => {
    await login(values);
  });
  return (
    <section
      className="auth-card auth-card--login"
      aria-labelledby="login-title"
    >
      <header>
        <p className="step-label">Management dashboard</p>
        <h2 id="login-title">Sign in to Tilecast</h2>
        <p>Use the local account for this installation.</p>
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
          autoComplete="username"
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
          className="button button--primary"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <Brand />
      <span className="spinner" aria-label="Loading" />
    </div>
  );
}
