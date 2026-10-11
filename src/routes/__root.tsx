import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useTableSync, getTableRealtimeManager } from "../lib/tableStore";
import { useTableOrdersSync, getTableOrdersRealtimeManager } from "../lib/tableOrdersStore";
import { useGlobalSupplementsSync } from "../lib/globalSupplementsStore";
import { App as CapacitorApp } from "@capacitor/app";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { PageLoader } from "../components/ui/PageLoader";
import {
  PrintQueueDaemon,
  getPrintQueueRealtimeManager,
} from "../components/pos/PrintQueueDaemon";
import { PrintFailureBanner } from "../components/pos/PrintFailureBanner";
import { HubForegroundSync } from "../components/pos/HubForegroundSync";
import { useSessionStore } from "../lib/authStore";
import { UserLogin } from "../components/auth/UserLogin";
import {
  isLocalDevicePrimaryHub,
  usePrintSettingsStore,
} from "../lib/printSettingsStore";
import { scheduleHubAutoBluetoothProbe } from "../lib/printerProbe";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Detect chunk load errors (stale WebView cache after a new deployment). */
function isChunkLoadError(error: Error): boolean {
  return (
    error.message?.includes("Failed to fetch dynamically imported module") ||
    error.message?.includes("Importing a module script failed") ||
    error.name === "ChunkLoadError"
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  useEffect(() => {
    // If it's a chunk load error (stale cache after new deployment), reload silently.
    if (isChunkLoadError(error)) {
      console.warn("[ChunkLoadError] Stale cache detected — reloading the app.");
      window.location.reload();
      return;
    }
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  // Show a minimal UI while the reload is in progress.
  if (isChunkLoadError(error)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Mise à jour détectée, rechargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-4 p-4 bg-red-100 text-red-900 rounded-lg text-left overflow-auto text-xs font-mono max-h-40">
          <p className="font-bold">{error.name}: {error.message}</p>
          <p className="mt-2 whitespace-pre-wrap">{error.stack}</p>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Z-pekenio — Caisse POS" },
      { name: "description", content: "Logiciel de caisse pour le restaurant Z-pekenio." },
      { name: "author", content: "Z-pekenio" },
      { property: "og:title", content: "Z-pekenio — Caisse POS" },
      { property: "og:description", content: "Logiciel de caisse pour le restaurant Z-pekenio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
  pendingComponent: PageLoader,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const currentUser = useSessionStore((s) => s.currentUser);
  const isLoggedIn = !!currentUser;
  
  const routerState = useRouter();
  const isAdminRoute = routerState.state.location.pathname.startsWith("/admin");
  // Public routes accessible without login
  const isPublicRoute = routerState.state.location.pathname.startsWith("/menu");
  // Ensures print_settings loads for hub ownership (worker mounts when primary)
  const { isPrimaryHub, loading: printSettingsLoading } = usePrintSettingsStore();

  // Daemon + failure banner: logged-in (any device) OR primary hub (always, even logged out)
  const mountPrintStack =
    !printSettingsLoading && (isLoggedIn || isPrimaryHub);

  // ── Sync stores : ne s'initialisent QU'APRÈS le login ───────────────────────
  // Avant le login, currentUser === null → isLoggedIn === false → aucun appel
  // Supabase, aucun channel Realtime. Dès que l'utilisateur se connecte,
  // isLoggedIn passe à true et les managers s'initialisent (idempotents).
  useTableSync(isLoggedIn);
  useTableOrdersSync(isLoggedIn);
  useGlobalSupplementsSync(isLoggedIn);

  // ── Global ChunkLoadError handler ───────────────────────────────────────────
  // When the WebView has stale cache after a new Vercel deployment, dynamic
  // imports fail. Catch them globally and force a full reload so the user
  // gets the latest version automatically.
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message ?? "";
      if (
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed") ||
        event.reason?.name === "ChunkLoadError"
      ) {
        console.warn("[ChunkLoadError] Stale WebView cache — reloading.");
        event.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  // ── Lifecycle Capacitor Android : retour au foreground ──────────────────────
  // Tables/orders: logged-in only. Print Realtime: primary hub always (session-decoupled).
  useEffect(() => {
    let mounted = true;

    const registerForegroundListener = async () => {
      try {
        await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
          if (!mounted || !isActive) return;

          const isHub = isLocalDevicePrimaryHub();

          if (isLoggedIn) {
            console.log("[Realtime:Root] FOREGROUND — vérification des channels");
            void getTableRealtimeManager().handleForeground();
            void getTableOrdersRealtimeManager().handleForeground();
          }

          if (isLoggedIn || isHub) {
            void getPrintQueueRealtimeManager()?.handleForeground();
            if (isHub) {
              // Never race production — probeAllPrinters defers when queue busy
              scheduleHubAutoBluetoothProbe(1500);
            }
          }
        });
      } catch {
        // Sur le web (navigateur), Capacitor App n'est pas disponible → silencieux
      }
    };

    void registerForegroundListener();

    return () => {
      mounted = false;
      // Cleanup : supprimer tous les listeners Capacitor pour éviter les leaks
      void CapacitorApp.removeAllListeners().catch(() => {
        // Ignorer les erreurs si Capacitor n'est pas disponible (web)
      });
    };
  }, [isLoggedIn, isPrimaryHub]);

  return (
    <QueryClientProvider client={queryClient}>
      {!isLoggedIn && !isAdminRoute && !isPublicRoute ? (
        <UserLogin />
      ) : (
        <Outlet />
      )}
      <HubForegroundSync />
      {/* Print queue daemon + failure banner (login OR primary hub) */}
      {mountPrintStack && (
        <>
          <PrintQueueDaemon />
          <PrintFailureBanner />
        </>
      )}
    </QueryClientProvider>
  );
}
