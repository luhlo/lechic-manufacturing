"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Timer,
  LayoutDashboard,
  Users,
  Briefcase,
  ShieldCheck,
  Layers,
  Package,
  ClipboardList,
  Target,
  ChartNoAxesCombined,
  Settings,
  LogOut,
  RefreshCw,
  WifiOff,
  Menu,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Api, SessionStore, clientFor, message } from "@/lib/manufacturing/api";
import { pageFromPath, pathForPage, landingPage } from "@/lib/manufacturing/routes";
import {
  allowed,
  canViewPage,
  type CachedState,
} from "@/lib/manufacturing/types";
import { Employee } from "./employee";
import { Management } from "./management";
import { Analytics } from "./analytics";
import { Dashboard } from "./dashboard";
import { Auth } from "./login-form";
import type { SupabaseClient } from "@supabase/supabase-js";
const navigation = [
  { id: "work", title: "My work", icon: Timer },
  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "profiles",
    title: "Employees",
    icon: Users,
  },
  {
    id: "positions",
    title: "Positions",
    icon: Briefcase,
  },
  {
    id: "roles",
    title: "Permissions",
    icon: ShieldCheck,
  },
  {
    id: "activities",
    title: "Activities",
    icon: Layers,
  },
  {
    id: "products",
    title: "Designs",
    icon: Package,
  },
  {
    id: "assignments",
    title: "Assignments",
    icon: ClipboardList,
  },
  { id: "kpi_targets", title: "KPIs", icon: Target },
  {
    id: "analytics",
    title: "Analytics",
    icon: ChartNoAxesCombined,
  },
  {
    id: "settings",
    title: "Settings",
    icon: Settings,
  },
];
export function ManufacturingApp({
  url,
  publishableKey,
}: {
  url: string;
  publishableKey: string;
}) {
  const [client, setClient] = useState<SupabaseClient | null>(null),
    [store, setStore] = useState<SessionStore | null>(null),
    [state, setState] = useState<CachedState | null>(null),
    [page, setPage] = useState(
      () => pageFromPath(window.location.pathname) ?? "work",
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [online, setOnline] = useState(true),
    [recovery, setRecovery] = useState(false),
    [busy, setBusy] = useState(false);
  const [navigationSession, setNavigationSession] = useState<string | null>(null);
  const navigate = useCallback((next: string, replace = false) => {
    const path = pathForPage(next);
    if (window.location.pathname !== path) {
      // Preserve auth callback values until Supabase consumes them.
      const destination = path + window.location.search + window.location.hash;
      window.history[replace ? "replaceState" : "pushState"](
        {},
        "",
        destination,
      );
    }
    setPage(next);
  }, []);
  useEffect(() => {
    const restoreRoute = () =>
      setPage(pageFromPath(window.location.pathname) ?? "work");
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, []);
  const storeRef = useRef<SessionStore | null>(null);
  const version = useRef(0);
  const busyRef = useRef(false);
  const [reauth, setReauth] = useState(false);
  const publish = useCallback((s: SessionStore) => {
    if (storeRef.current === s)
      setState(s.state ? structuredClone(s.state) : null);
  }, []);
  const activate = useCallback(
    async (api: Api, uid: string, signedIn = false) => {
      const n = ++version.current;
      const s = new SessionStore(api, uid);
      storeRef.current = s;
      setStore(s);
      setState(null);
      setLoading(true);
      setError("");
      try {
        await s.load();
        if (n !== version.current) return;
        publish(s);
        const requested = pageFromPath(window.location.pathname);
        navigate(landingPage(s.state!.context.permissions, requested, s.state!.session, signedIn), true);
      } catch (e) {
        if (n === version.current) {
          setError(message(e));
          publish(s);
          if (s.state?.session && s.state.session.status !== "completed" && canViewPage(s.state.context.permissions,"work")) navigate("work",true);
        }
      } finally {
        if (n === version.current) setLoading(false);
      }
    },
    [publish, navigate],
  );
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setOnline(navigator.onLine);
      if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
        navigator.serviceWorker
          .register(import.meta.env.BASE_URL + "sw.js", {
            scope: import.meta.env.BASE_URL,
            updateViaCache: "none",
          })
          .catch(() => {});
      if (!url || !publishableKey) {
        setLoading(false);
        return;
      }
      let c: SupabaseClient;
      try {
        c = clientFor(url, publishableKey);
        setClient(c);
      } catch (e) {
        setError(message(e));
        setLoading(false);
        return;
      }
      const { data } = c.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          setRecovery(true);
        }
        if (session) setReauth(false);
        if (event === "SIGNED_OUT") {
          version.current++;
          storeRef.current = null;
          setStore(null);
          setState(null);
          window.history.replaceState(
            {},
            "",
            import.meta.env.BASE_URL + "login",
          );
          setPage("work");
          setLoading(false);
        } else if (session && storeRef.current?.uid !== session.user.id) {
          void activate(new Api(c), session.user.id, event === "SIGNED_IN");
        } else if (!session) setLoading(false);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [url, publishableKey, activate]);
  const reload = useCallback(async () => {
    const s = storeRef.current;
    if (!s) return;
    try {
      await s.refresh();
      publish(s);
      if (storeRef.current === s) setError("");
    } catch (e) {
      if (storeRef.current === s) setError(message(e));
      publish(s);
    }
  }, [publish]);
  useEffect(() => {
    const resume = () => {
      setOnline(navigator.onLine);
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void reload();
    }, 30000);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      clearInterval(tick);
    };
  }, [reload]);
  const run = async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      if (store) publish(store);
    } catch (e) {
      toast.error(page === "work" ? workError(e, store?.state ?? null) : message(e));
      if (store) publish(store);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const signOut = async () => {
    await store?.signOut(async () => {
      const result = await client?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
    });
  };
  if (recovery && client)
    return <PasswordRecovery client={client} done={() => setRecovery(false)} />;
  if (!state)
    return (
      <>
        <div className="login">
          <div className="login-art">
            <Brand />
            <div>
              <p className="eyebrow">LE CHIC MIAMI</p>
              <h1>
                Make every
                <br />
                minute visible.
              </h1>
              <p>
                Activity, time, and progress.
                <br />
                One simple place for the studio.
              </p>
            </div>
            <span className="login-caption">MANUFACTURING / WORKSPACE</span>
          </div>
          <div className="login-panel">
            <div className="mobile-brand">
              <Brand />
            </div>
            {loading ? (
              <div role="status">Restoring your workspace…</div>
            ) : (
              <Auth client={client} error={error} />
            )}
          </div>
        </div>
        <Toaster />
      </>
    );
  const permitted = navigation.filter((n) =>
    canViewPage(state.context.permissions, n.id),
  );
  const selected = permitted.find((n) => n.id === page);
  const current =
    selected && canViewPage(state.context.permissions, page) ? page : "denied";
  const managed = permitted.length > 1;
  const focusedWork = current === "work" && state.session && state.session.status !== "completed" && navigationSession !== state.session.id;
  return (
    <SidebarProvider>
      <div className={"workspace " + (!managed ? "employee-only" : "") + (focusedWork ? " focused-work" : "")}>
        {managed && !focusedWork && (
          <Sidebar className="studio-sidebar">
            <SidebarHeader>
              <Brand />
              <span className="workspace-label">MANUFACTURING</span>
            </SidebarHeader>
            <SidebarContent>
              <SidebarMenu>
                {permitted.map((n) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton
                      isActive={current === n.id}
                      onClick={() => navigate(n.id)}
                      tooltip={n.title}
                    >
                      <n.icon />
                      <span>{n.title}</span>
                      {n.id === "work" &&
                        state.session?.status === "running" && (
                          <i className="live-dot" />
                        )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarContent>
            <SidebarFooter>
              <div className="avatar-line">
                <span className="avatar">
                  {state.context.profile.name.slice(0, 1)}
                </span>
                <div>
                  <strong>{state.context.profile.name}</strong>
                  <small>
                    {state.catalog.positions.find(
                      (p) => p.id === state.context.profile.position_id,
                    )?.name ?? "No position assigned"}
                  </small>
                </div>
              </div>
              <button className="text-button" onClick={() => void run(signOut)}>
                <LogOut size={16} /> Sign out
              </button>
            </SidebarFooter>
          </Sidebar>
        )}
        <SidebarInset>
          <header className="topbar">
            <div className="topbar-left">
              {managed && focusedWork ? (
                <button className="text-button work-navigation" onClick={()=>setNavigationSession(state.session!.id)}>Navigation</button>
              ) : managed ? (
                <SidebarTrigger aria-label="Toggle navigation">
                  <Menu />
                </SidebarTrigger>
              ) : (
                <Brand />
              )}
              <span className="breadcrumb">
                {selected?.title ?? "Access unavailable"}
              </span>
            </div>
            <div className="topbar-right">
              <span className={"sync-status " + (!online ? "offline" : "")}>
                {!online && <WifiOff size={15} />}
                <span>
                  {state.conflict
                    ? "Sync needs review"
                    : state.queue.length
                      ? `${state.queue.length} pending`
                      : state.syncError
                        ? "Sync pending"
                        : online
                          ? "Synced"
                          : "Offline"}
                </span>
              </span>
              <button
                className="icon-button"
                aria-label="Sync now"
                disabled={busy}
                onClick={() => void run(reload)}
              >
                <RefreshCw size={17} />
              </button>
              {!managed && (
                <button
                  className="icon-button"
                  aria-label="Sign out"
                  onClick={() => void run(signOut)}
                >
                  <LogOut size={17} />
                </button>
              )}
            </div>
          </header>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {state.syncError && (
            <div className="notice" role="status">
              {state.syncError}
              {client && (
                <button className="text-button" onClick={() => setReauth(true)}>
                  Sign in again
                </button>
              )}
            </div>
          )}
          {reauth && (
            <div className="recovery">
              <Auth client={client} error="" />
              <button className="text-button" onClick={() => setReauth(false)}>
                Back to work
              </button>
            </div>
          )}
          {state.conflict && (
            <div className="notice error">
              <strong>Pending work needs review.</strong>
              <p>{state.conflict}</p>
              <p>
                Your {state.queue.length} pending events remain saved on this
                device. Accepting the server session will archive those events
                locally for manager review.
              </p>
              <details>
                <summary>Review pending events</summary>
                <pre>{JSON.stringify(state.queue, null, 2)}</pre>
              </details>
              <button
                className="button secondary"
                onClick={() =>
                  void run(async () => {
                    await store!.recoverServer();
                    await reload();
                  })
                }
              >
                Use server session and archive pending events
              </button>
            </div>
          )}
          <main
            className={
              "main-content " + (current === "work" ? "work-content" : "")
            }
          >
            {current === "denied" ? (
              <section className="settings-card" role="alert">
                <h1>Access unavailable</h1>
                <p>
                  Your position does not have access to this page. Contact your
                  Operations Manager.
                </p>
                {permitted[0] && (
                  <button
                    className="button primary"
                    onClick={() => navigate(permitted[0].id, true)}
                  >
                    Open {permitted[0].title}
                  </button>
                )}
              </section>
            ) : current === "work" ? (
              <Employee
                state={state}
                store={store!}
                busy={busy}
                run={run}
                online={online}
              />
            ) : current === "dashboard" &&
              !allowed(state.context.permissions, "analytics.view") ? (
              <Dashboard api={store!.api} lastSync={state.lastSync} />
            ) : current === "dashboard" || current === "analytics" ? (
              <Analytics
                key={current}
                api={store!.api}
                state={state}
                dashboard={current === "dashboard"}
                onNavigate={navigate}
              />
            ) : (
              <Management
                key={current}
                page={current}
                state={state}
                api={store!.api}
                refresh={reload}
              />
            )}
            {!allowed(state.context.permissions, "my_work.access") &&
              state.session &&
              state.session.status !== "completed" && (
                <section className="settings-card">
                  <p>
                    My work access has changed. Finish your existing session
                    below; new sessions are unavailable.
                  </p>
                  <Employee
                    state={state}
                    store={store!}
                    busy={busy}
                    run={run}
                    online={online}
                  />
                </section>
              )}
          </main>
        </SidebarInset>
      </div>
      <Toaster position="top-center" richColors />
    </SidebarProvider>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span
        className="brand-logo"
        role="img"
        aria-label="Le Chic Miami"
        style={{
          maskImage: `url(${import.meta.env.BASE_URL}le-chic-miami-logo.svg)`,
          WebkitMaskImage: `url(${import.meta.env.BASE_URL}le-chic-miami-logo.svg)`,
        }}
      />
    </div>
  );
}
function PasswordRecovery({
  client,
  done,
}: {
  client: SupabaseClient;
  done: () => void;
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState("");
  return (
    <main className="recovery">
      <h1>Choose a new password</h1>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const { error } = await client.auth.updateUser({ password });
          if (error) setError(error.message);
          else done();
        }}
      >
        <label className="field">
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="button primary">Save password</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

function workError(error: unknown, state: CachedState | null) {
  const text = message(error);
  if (/RPC|fetch|network|timeout|invocation/i.test(text)) {
    return state?.queue.length
      ? "We couldn’t sync that yet. Your pending work is saved on this device. Try Sync when connected."
      : "We couldn’t save that yet. Keep this screen open and try again.";
  }
  return text;
}
