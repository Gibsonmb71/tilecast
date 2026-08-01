import { KeyRound, Palette, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { PageHeader } from "../components/ui";
import { PreferencesPage } from "./PreferencesPage";
import { SecurityPage } from "./SecurityPage";
import type { User } from "../api/types";
import "./MyAccountPage.css";

const roleLabels: Record<User["role"], string> = {
  owner: "Owner",
  administrator: "Administrator",
  editor: "Editor",
  contributor: "Contributor",
  viewer: "Viewer",
};

export function MyAccountPage() {
  const { status } = useAuth();
  const user = status?.user;
  const initial = user?.name.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <section className="my-account-page">
      <PageHeader
        eyebrow="Account"
        title="My Account"
        description="Manage your Tilecast profile, preferences, and sign-in protection."
      />

      <section
        className="my-account-profile"
        aria-labelledby="account-profile-title"
      >
        <div className="my-account-profile__avatar" aria-hidden="true">
          {initial}
        </div>
        <div className="my-account-profile__identity">
          <p className="my-account-profile__eyebrow">Your Tilecast account</p>
          <h2 id="account-profile-title">{user?.name ?? "Your account"}</h2>
          <p>{user?.username ?? "Signed-in account"}</p>
        </div>
        <div className="my-account-profile__facts">
          <div>
            <span>Role</span>
            <strong>{user ? roleLabels[user.role] : "—"}</strong>
          </div>
          <div>
            <span>Account status</span>
            <strong>{user?.active === false ? "Inactive" : "Active"}</strong>
          </div>
        </div>
      </section>

      <div className="my-account-cards">
        <section
          id="preferences"
          className="my-account-card my-account-card--preferences"
          aria-labelledby="account-preferences-title"
        >
          <header className="my-account-card__header">
            <span className="my-account-card__icon" aria-hidden="true">
              <Palette size={20} />
            </span>
            <div>
              <h2 id="account-preferences-title">Preferences</h2>
              <p>Choose how Tilecast Studio looks and behaves for you.</p>
            </div>
          </header>
          <div className="my-account-card__body">
            <PreferencesPage embedded />
          </div>
        </section>

        <section
          id="security"
          className="my-account-card my-account-card--security"
          aria-labelledby="account-security-title"
        >
          <header className="my-account-card__header">
            <span className="my-account-card__icon" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h2 id="account-security-title">Sign-in security</h2>
              <p>
                Protect this account with an authenticator, passkey, or recovery
                codes.
              </p>
            </div>
          </header>
          <div className="my-account-card__body">
            <SecurityPage embedded />
          </div>
        </section>
      </div>

      <div className="my-account-note">
        <KeyRound size={17} aria-hidden="true" />
        <p>
          Sign-in security changes apply only to your account. Organization-wide
          multi-factor requirements remain under Settings.
        </p>
      </div>
    </section>
  );
}
