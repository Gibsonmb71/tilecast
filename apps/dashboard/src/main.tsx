import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@tilecast/design-tokens/tokens.css";
import "./theme";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./styles.css";
import "./styles/layout-fonts.css";
import "./styles/signal.css";
import "./styles/topbar.css";
// Page-specific refinements intentionally load after shared Signal styles.
import "./styles/reliability.css";
import "./styles/screens.css";
import "./styles/account-menu.css";
import "./styles/issue-fixes.css";
import "./styles/issues-37-45.css";
import "./styles/issues-48-49.css";
import "./styles/data-sources.css";
import "./styles/player-updates.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
