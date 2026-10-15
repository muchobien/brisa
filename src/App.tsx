import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Code2,
  Copy,
  ExternalLink,
  GitFork,
  Hash,
  Inbox,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogOut,
  MailOpen,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Unplug,
  Wind,
  X,
} from "lucide-react";
import type {
  Heartbeat,
  Notification as Notice,
  Priority,
  Snapshot,
  TopicColor,
} from "../shared/contracts";
import { api, post, relativeTime, remove, subscribeDevice } from "./lib/api";
import { Button, EmptyState, Field, IconButton, Logo, Modal } from "./design-system/components";

type Page = "inbox" | "topics" | "integrations" | "devices" | "settings";
type Dialog = "topic" | "compose" | "token" | "device" | "heartbeat" | null;
const pages = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "topics", label: "Topics", icon: Layers3 },
  { id: "integrations", label: "Integrations", icon: Unplug },
  { id: "devices", label: "Devices", icon: Monitor },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
const colors: TopicColor[] = ["violet", "blue", "mint", "amber", "rose"];
const descriptions: Record<Page, string> = {
  inbox: "Everything that matters. A little less noise.",
  topics: "A little order for everything you follow.",
  integrations: "Let your services do the talking.",
  devices: "Your notifications, wherever you are.",
  settings: "Make a little space for your preferences.",
};
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>("inbox");
  const [topic, setTopic] = useState("all");
  const [filter, setFilter] = useState<"all" | "unread" | "important">("all");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [detail, setDetail] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    action: () => Promise<unknown>;
  } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("brisa:theme") === "dark");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [syncError, setSyncError] = useState(false);

  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const load = useCallback(async () => {
    const data = await api<Snapshot>("/snapshot");
    setSnapshot(data);
    setSyncError(false);
    const id = new URLSearchParams(location.search).get("notification");
    if (id) {
      const notice = data.notifications.find((n) => n.id === id);
      if (notice) setDetail(notice);
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  const start = useCallback(() => {
    return api<{ authenticated: boolean; configured: boolean }>("/session")
      .then((result) => {
        setAuthenticated(result.authenticated);
        setConfigured(result.configured);
        setStartupError("");
      })
      .catch((error: unknown) => {
        setStartupError(errorText(error));
      });
  }, []);
  useEffect(() => {
    void start();
  }, [start]);
  useEffect(() => {
    const unauthorized = () => {
      setAuthenticated(false);
      setSnapshot(null);
      setDetail(null);
      setDialog(null);
      setNewToken("");
    };
    window.addEventListener("brisa:unauthorized", unauthorized);
    return () => window.removeEventListener("brisa:unauthorized", unauthorized);
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => {
      void load().catch(() => setSyncError(true));
    };
    refresh();
    const timer = setInterval(refresh, 20000);
    const visibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [authenticated, load]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("brisa:theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !(
          target instanceof HTMLElement &&
          (target.matches("input,textarea,select") || target.isContentEditable)
        )
      ) {
        const input = document.querySelector<HTMLInputElement>(".search input");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const perform = async (action: () => Promise<unknown>, message?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      await load();
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(errorText(error), true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const unread = snapshot?.topics.reduce((sum, t) => sum + t.unread, 0) ?? 0;
  const visible = useMemo(
    () =>
      (snapshot?.notifications ?? []).filter(
        (n) =>
          (topic === "all" || n.topic_id === topic) &&
          (filter !== "unread" || !n.read_at) &&
          (filter !== "important" || n.priority === "urgent" || n.priority === "high") &&
          `${n.title} ${n.body} ${n.topic_name}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [snapshot, topic, filter, search],
  );
  const openNotice = (notice: Notice) => {
    setDetail(notice);
    if (!notice.read_at) void perform(() => post("/notifications/read", { ids: [notice.id] }));
  };
  const chooseTopic = (id: string) => {
    setTopic(id);
    setPage("inbox");
    setFilter("all");
  };

  if (authenticated === null || startupError)
    return (
      <div className="auth-layout">
        <div className="auth-card glass">
          <Logo />
          <h1>{startupError ? "A little out of reach." : "Making a little space…"}</h1>
          <p>{startupError || "Opening your workspace."}</p>
          {startupError ? (
            <Button onClick={() => void start()}>Try again</Button>
          ) : (
            <LoaderCircle className="spin" />
          )}
        </div>
      </div>
    );
  if (!authenticated)
    return <Login configured={configured} onLogin={() => setAuthenticated(true)} />;
  if (!snapshot)
    return (
      <div className="auth-layout">
        <div className="auth-card glass">
          <Logo />
          <h1>{syncError ? "Could not open your inbox." : "Opening your inbox…"}</h1>
          {syncError ? (
            <Button onClick={() => void load().catch(() => setSyncError(true))}>Try again</Button>
          ) : (
            <LoaderCircle className="spin" />
          )}
        </div>
      </div>
    );

  const currentTopic = snapshot.topics.find((t) => t.id === topic);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar glass">
        <Logo />
        <div className="workspace-pill">
          <span className="workspace-avatar">B</span>
          <div>
            <strong>Your workspace</strong>
            <small>A little more connected</small>
          </div>
          <span className="status-dot" />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => {
                setPage(id);
                if (id === "inbox") setTopic("all");
              }}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "inbox" && unread > 0 && <span className="count">{unread}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-title">
          <span>YOUR TOPICS</span>
          <IconButton label="Create topic" onClick={() => setDialog("topic")}>
            <Plus size={15} />
          </IconButton>
        </div>
        <nav className="topic-nav" aria-label="Topics">
          {snapshot.topics.map((t) => (
            <button
              className={`topic-nav-item ${page === "inbox" && topic === t.id ? "selected" : ""}`}
              key={t.id}
              onClick={() => chooseTopic(t.id)}
            >
              <span className={`topic-dot color-${t.color}`} />
              <span>{t.name}</span>
              {t.unread > 0 && <small>{t.unread}</small>}
            </button>
          ))}
          {snapshot.topics.length === 0 && (
            <p className="sidebar-hint">A topic gives your notifications a home.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="little-note">
            <Wind size={24} />
            <p>
              Good things,
              <br />
              <strong>without the noise.</strong>
            </p>
          </div>
          <a
            className="source-link"
            href="https://github.com/muchobien/brisa"
            target="_blank"
            rel="noreferrer"
          >
            <GitFork size={16} /> Open source, by mucho bien <ArrowRight size={14} />
          </a>
        </div>
      </aside>
      <main id="main" className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="desktop-only">Your workspace</span>
            <ChevronRight size={14} className="desktop-only" />
            <span>{pages.find((p) => p.id === page)?.label}</span>
          </div>
          <div className="topbar-actions">
            <span className="connection">
              <span className={`status-dot ${offline || syncError ? "warning" : ""}`} />
              {offline ? "Offline" : syncError ? "Reconnecting" : "Connected"}
            </span>
            <IconButton
              label={dark ? "Use light appearance" : "Use dark appearance"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            <span className="avatar" aria-label="Workspace account">
              B
            </span>
          </div>
        </header>
        {(offline || syncError) && (
          <div className="connection-banner" role="status">
            {offline
              ? "You’re offline. Reconnect to update your inbox."
              : "Your inbox could not refresh. We’ll try again shortly."}
          </div>
        )}
        <div className="page-heading">
          <div>
            <p className="eyebrow">A QUIETER KIND OF CONNECTED</p>
            <h1>
              {page === "inbox" && currentTopic
                ? currentTopic.name
                : pages.find((p) => p.id === page)?.label}
              <span className="heading-period">.</span>
            </h1>
            <p>{descriptions[page]}</p>
          </div>
          <Button
            onClick={() =>
              setDialog(
                page === "topics"
                  ? "topic"
                  : page === "devices"
                    ? "device"
                    : page === "integrations"
                      ? "token"
                      : "compose",
              )
            }
            disabled={page !== "topics" && snapshot.topics.length === 0}
          >
            <Plus size={17} />
            {page === "topics"
              ? "New topic"
              : page === "devices"
                ? "Add this device"
                : page === "integrations"
                  ? "Create key"
                  : "Send notification"}
          </Button>
        </div>
        {page === "inbox" && (
          <>
            {snapshot.devices.length === 0 && (
              <div className="welcome-banner glass">
                <div className="banner-icon">
                  <BellRing size={25} />
                </div>
                <div>
                  <strong>A gentle nudge, wherever you are.</strong>
                  <p>Connect this device to get notifications beyond your inbox.</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={snapshot.topics.length === 0}
                  onClick={() => setDialog("device")}
                >
                  Enable push <ArrowRight size={16} />
                </Button>
              </div>
            )}
            <div className="inbox-toolbar">
              <div className="segmented" aria-label="Filter notifications">
                {(["all", "unread", "important"] as const).map((f) => (
                  <button
                    key={f}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={filter === f ? "selected" : ""}
                  >
                    {f === "all" ? "All messages" : f === "unread" ? "Unread" : "Important"}
                    {f === "unread" && unread > 0 && <span>{unread}</span>}
                  </button>
                ))}
              </div>
              <div className="inbox-tools">
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search notifications"
                    placeholder="Search anything…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>/</kbd>
                </label>
                <IconButton
                  label="Mark visible notifications as read"
                  disabled={busy || !visible.some((n) => !n.read_at)}
                  onClick={() =>
                    void perform(
                      () =>
                        post("/notifications/read", {
                          ids: visible.filter((n) => !n.read_at).map((n) => n.id),
                        }),
                      "All caught up",
                    )
                  }
                >
                  <CheckCheck size={19} />
                </IconButton>
              </div>
            </div>
            <div className="feed-label">
              <span>
                {topic === "all" ? "YOUR NOTIFICATIONS" : `# ${currentTopic?.name ?? "TOPIC"}`}
              </span>
              <span>
                {visible.length} {visible.length === 1 ? "message" : "messages"}
              </span>
            </div>
            <section className="notification-feed" aria-label="Notifications">
              {visible.length ? (
                visible.map((notice, index) => (
                  <NotificationCard
                    key={notice.id}
                    notice={notice}
                    index={index}
                    onOpen={() => openNotice(notice)}
                    onRead={() =>
                      void perform(() =>
                        post("/notifications/read", {
                          ids: [notice.id],
                          read: !notice.read_at,
                        }),
                      )
                    }
                  />
                ))
              ) : (
                <EmptyState
                  icon={<Inbox size={30} />}
                  title={
                    snapshot.topics.length === 0
                      ? "A fresh start."
                      : search || filter !== "all"
                        ? "A little peace and quiet."
                        : "Room for what matters."
                  }
                  action={
                    snapshot.topics.length === 0 ? (
                      <Button onClick={() => setDialog("topic")}>
                        <Plus size={16} />
                        Create your first topic
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setDialog("compose")}>
                        Send a first notification
                      </Button>
                    )
                  }
                >
                  {snapshot.topics.length === 0
                    ? "Create a topic, connect a service, and let the good things find you."
                    : search || filter !== "all"
                      ? "No notifications match this view. Try another filter or search."
                      : "Your notifications will settle here when your services have something to say."}
                </EmptyState>
              )}
            </section>
            <footer className="feed-footer">
              <Wind size={16} />
              <span>
                {snapshot.notifications.length >= 500
                  ? "Showing your 500 most recent messages. History is kept for 30 days."
                  : "You’ve found your little corner of calm."}
              </span>
            </footer>
          </>
        )}
        {page === "topics" && (
          <>
            <div className="section-heading">
              <h2>
                Your channels of calm <span>{snapshot.topics.length}</span>
              </h2>
              <p>Give each service its own space.</p>
            </div>
            <div className="topic-grid">
              {snapshot.topics.map((t) => (
                <article className="topic-card glass" key={t.id}>
                  <div className="card-top">
                    <span className={`tile-icon color-${t.color}`}>
                      <Hash size={25} />
                    </span>
                    <IconButton
                      label={`Delete ${t.name}`}
                      onClick={() =>
                        setConfirm({
                          title: `Delete ${t.name}?`,
                          body: "This also removes its messages, publishing keys, and heartbeat monitors. This cannot be undone.",
                          action: () => remove(`/topics/${t.id}`),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                  <h3>{t.name}</h3>
                  <p>{t.description || "A space for your notifications."}</p>
                  <div className="topic-card-footer">
                    <span>
                      {t.total} messages {t.unread > 0 && <b>· {t.unread} unread</b>}
                    </span>
                    <button onClick={() => chooseTopic(t.id)} aria-label={`Open ${t.name}`}>
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </article>
              ))}
              <button className="add-topic-card" onClick={() => setDialog("topic")}>
                <span>
                  <Plus size={25} />
                </span>
                <strong>A new little space</strong>
                <small>Create a topic</small>
              </button>
            </div>
          </>
        )}
        {page === "devices" && (
          <>
            <div className="info-note">
              <Smartphone size={20} />
              <div>
                <strong>On iPhone or iPad?</strong>
                <p>
                  Open Brisa in Safari, tap Share → Add to Home Screen, then open the app and enable
                  notifications. Requires iOS 16.4 or later.
                </p>
              </div>
            </div>
            <div className="section-heading">
              <h2>
                Connected devices <span>{snapshot.devices.length}</span>
              </h2>
              <p>Each device chooses the topics it follows.</p>
            </div>
            {snapshot.devices.length === 0 ? (
              <EmptyState
                icon={<Monitor size={30} />}
                title="A little closer, on every screen."
                action={
                  <Button disabled={!snapshot.topics.length} onClick={() => setDialog("device")}>
                    Connect this device
                  </Button>
                }
              >
                Add this device to receive push notifications when the app is in the background.
              </EmptyState>
            ) : (
              <div className="stack">
                {snapshot.devices.map((device) => (
                  <div className="list-card glass" key={device.id}>
                    <span className="tile-icon color-violet">
                      {/phone|iphone|android/i.test(device.name) ? (
                        <Smartphone size={22} />
                      ) : (
                        <Monitor size={22} />
                      )}
                    </span>
                    <div className="list-card-copy">
                      <h3>
                        {device.name}{" "}
                        {device.id === localStorage.getItem("brisa:device") && (
                          <span className="badge">This device</span>
                        )}
                      </h3>
                      <p>
                        {device.topics
                          .map((id) => snapshot.topics.find((t) => t.id === id)?.name)
                          .filter(Boolean)
                          .join(", ") || "No topics"}{" "}
                        · Added {relativeTime(device.created_at)}
                      </p>
                    </div>
                    <IconButton
                      label={`Remove ${device.name}`}
                      onClick={() =>
                        setConfirm({
                          title: "Disconnect this device?",
                          body: "It will stop receiving notifications. You can connect it again later.",
                          action: async () => {
                            await remove(`/devices/${device.id}`);
                            if (device.id === localStorage.getItem("brisa:device")) {
                              const registration = await navigator.serviceWorker.ready;
                              await (
                                await registration.pushManager.getSubscription()
                              )?.unsubscribe();
                              localStorage.removeItem("brisa:device");
                            }
                          },
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <div className="quiet-caption">
              <ShieldCheck size={17} />
              Push payloads are encrypted for each device. Browser vendors handle delivery.
            </div>
          </>
        )}
        {page === "integrations" && (
          <>
            <div className="integration-grid">
              <div className="integration-card glass">
                <span className="tile-icon color-violet">
                  <Code2 size={25} />
                </span>
                <h3>One small request.</h3>
                <p>
                  Send a notification from any script, job, or service with a topic-scoped
                  publishing key.
                </p>
                <CodeBlock
                  code={`curl -X POST '${location.origin}/api/publish' \\\n  -H 'Authorization: Bearer YOUR_PUBLISHING_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"title":"Something good happened",\n       "body":"Your backup is ready.",\n       "priority":"normal"}'`}
                  onCopy={notify}
                />
              </div>
              <div className="integration-card glass">
                <span className="tile-icon color-amber">
                  <Activity size={25} />
                </span>
                <h3>Grafana, meet Brisa.</h3>
                <p>
                  Add a Webhook contact point in Grafana. Use this URL with your publishing key as
                  the Bearer authorization credential.
                </p>
                <CodeBlock code={`${location.origin}/api/webhooks/grafana`} onCopy={notify} />
                <p className="subtle">
                  Firing and resolved alerts arrive in the key’s topic. Repeated deliveries of the
                  same alert are deduplicated.
                </p>
                <a
                  className="text-link"
                  href="https://github.com/muchobien/brisa/blob/main/docs/integrations.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Integration guide <ArrowRight size={15} />
                </a>
              </div>
            </div>
            <div className="section-heading">
              <div>
                <h2>
                  Publishing keys <span>{snapshot.tokens.length}</span>
                </h2>
                <p>One topic per key. Revoke one at any time.</p>
              </div>
              <Button
                variant="secondary"
                disabled={!snapshot.topics.length}
                onClick={() => setDialog("token")}
              >
                <Plus size={16} />
                Create key
              </Button>
            </div>
            {snapshot.tokens.length === 0 ? (
              <div className="inline-empty glass">
                <KeyRound size={23} />
                <div>
                  <strong>Your services need a little introduction.</strong>
                  <p>Create a publishing key to connect your first integration.</p>
                </div>
              </div>
            ) : (
              <div className="stack">
                {snapshot.tokens.map((token) => (
                  <div className="list-card glass" key={token.id}>
                    <span className="tile-icon color-blue">
                      <KeyRound size={21} />
                    </span>
                    <div className="list-card-copy">
                      <h3>{token.name}</h3>
                      <p>
                        #{snapshot.topics.find((t) => t.id === token.topic_id)?.name} ·{" "}
                        {token.last_used_at
                          ? `Last used ${relativeTime(token.last_used_at)}`
                          : "Not used yet"}
                      </p>
                    </div>
                    <IconButton
                      label={`Revoke ${token.name}`}
                      onClick={() =>
                        setConfirm({
                          title: `Revoke ${token.name}?`,
                          body: "Services using this key will no longer be able to publish.",
                          action: () => remove(`/tokens/${token.id}`),
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <div className="section-heading">
              <div>
                <h2>
                  Heartbeats <span>{snapshot.heartbeats.length}</span>
                </h2>
                <p>A gentle check-in. An alert when it goes quiet.</p>
              </div>
              <Button
                variant="secondary"
                disabled={!snapshot.topics.length}
                onClick={() => setDialog("heartbeat")}
              >
                <Plus size={16} />
                New heartbeat
              </Button>
            </div>
            {snapshot.heartbeats.length === 0 ? (
              <div className="inline-empty glass">
                <Radio size={23} />
                <div>
                  <strong>Know when something stops checking in.</strong>
                  <p>Monitor a server or scheduled job independently of its own uptime.</p>
                </div>
              </div>
            ) : (
              <div className="stack">
                {snapshot.heartbeats.map((heartbeat) => (
                  <HeartbeatCard
                    key={heartbeat.id}
                    heartbeat={heartbeat}
                    onCopy={notify}
                    onDelete={() =>
                      setConfirm({
                        title: `Delete ${heartbeat.name}?`,
                        body: "Brisa will stop watching for this heartbeat.",
                        action: () => remove(`/heartbeats/${heartbeat.id}`),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
        {page === "settings" && (
          <>
            <div className="settings-panel glass">
              <h2>Feels like your space.</h2>
              <div className="setting-row">
                <div>
                  <strong>Appearance</strong>
                  <p>A soft glow, or a quieter evening.</p>
                </div>
                <div className="segmented">
                  <button
                    onClick={() => setDark(false)}
                    className={!dark ? "selected" : ""}
                    aria-pressed={!dark}
                  >
                    <Sun size={15} />
                    Light
                  </button>
                  <button
                    onClick={() => setDark(true)}
                    className={dark ? "selected" : ""}
                    aria-pressed={dark}
                  >
                    <Moon size={15} />
                    Dark
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Message history</strong>
                  <p>Messages are automatically removed after 30 days.</p>
                </div>
                <span className="badge">30 days</span>
              </div>
              <div className="setting-row">
                <div>
                  <strong>A shared workspace</strong>
                  <p>Read status and management access are shared across your devices.</p>
                </div>
                <Layers3 size={20} />
              </div>
              <div className="setting-row">
                <div>
                  <strong>Your session</strong>
                  <p>Sign out on this browser. Push stays enabled until the device is removed.</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await post("/logout", {});
                      setSnapshot(null);
                      setAuthenticated(false);
                    } catch (e) {
                      notify(errorText(e), true);
                    }
                  }}
                >
                  <LogOut size={16} />
                  Sign out
                </Button>
              </div>
            </div>
            <div className="about-card glass">
              <Logo />
              <h2>
                Small by design.
                <br />
                Yours by default.
              </h2>
              <p>
                Brisa is an open-source home for your notifications, running in your own Cloudflare
                account. No app store. No subscription to us. Just your little corner of connected.
              </p>
              <a
                className="button button-secondary"
                href="https://github.com/muchobien/brisa"
                target="_blank"
                rel="noreferrer"
              >
                <GitFork size={17} />
                Made by mucho bien <ArrowUpRightIcon />
              </a>
              <span className="version">BRISA 0.1.0</span>
            </div>
          </>
        )}
      </main>
      <nav className="mobile-nav glass" aria-label="Mobile navigation">
        {pages.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={label}
            aria-current={page === id ? "page" : undefined}
            className={page === id ? "selected" : ""}
            onClick={() => {
              setPage(id);
              if (id === "inbox") setTopic("all");
            }}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div
          className={`toast glass ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <CircleCheck size={18} />}
          {toast.text}
          <button aria-label="Dismiss message" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <CreateDialog
          kind={dialog}
          snapshot={snapshot}
          currentTopic={topic}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => {
            const ok = await perform(
              async () => {
                if (dialog === "topic") await post("/topics", body);
                if (dialog === "compose") await post("/notifications", body);
                if (dialog === "token") {
                  const result = await post<{ token: string }>("/tokens", body);
                  setNewToken(result.token);
                }
                if (dialog === "device") {
                  const value = body as { name: string; topics: string[] };
                  await subscribeDevice(snapshot.vapidPublicKey, value.name, value.topics);
                }
                if (dialog === "heartbeat") await post("/heartbeats", body);
              },
              dialog === "compose"
                ? "Notification sent to your inbox and connected devices"
                : dialog === "device"
                  ? "This device is connected"
                  : undefined,
            );
            if (ok) setDialog(null);
          }}
        />
      )}
      {newToken && (
        <Modal
          title="A key to your little space."
          description="Copy it somewhere safe. Brisa only stores its hash, so you won’t see this key again."
          onClose={() => setNewToken("")}
        >
          <CodeBlock code={newToken} onCopy={notify} />
          <div className="modal-actions">
            <Button onClick={() => setNewToken("")}>
              I’ve saved my key <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <div className="detail-meta">
            <span className={`topic-tag color-${detail.topic_color}`}>
              <Hash size={13} />
              {detail.topic_name}
            </span>
            <span>{new Date(detail.created_at).toLocaleString()}</span>
          </div>
          <p className="detail-body">
            {detail.body || "This notification has no additional message."}
          </p>
          <div className="detail-source">
            <span className={`priority priority-${detail.priority}`}>{detail.priority}</span>
            <span>Via {detail.source}</span>
          </div>
          <div className="modal-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm({
                  title: "Delete this notification?",
                  body: "This removes it from the shared inbox.",
                  action: async () => {
                    await remove(`/notifications/${detail.id}`);
                    setDetail(null);
                  },
                });
              }}
            >
              <Trash2 size={16} />
              Delete
            </Button>
            {detail.url && (
              <a
                className="button button-primary"
                href={detail.url}
                target="_blank"
                rel="noreferrer"
              >
                Open link <ExternalLink size={16} />
              </a>
            )}
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} description={confirm.body} onClose={() => setConfirm(null)}>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (await perform(confirm.action, "Done")) setConfirm(null);
              }}
            >
              Delete <Trash2 size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ExternalLink size={15} />;
}

function Login({ configured, onLogin }: { configured: boolean; onLogin: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/login", { key });
      setKey("");
      onLogin();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-decoration" aria-hidden="true">
        <div className="floating-preview glass">
          <span className="preview-icon">
            <Check size={23} />
          </span>
          <div>
            <strong>A little peace of mind.</strong>
            <p>Everything is right where it belongs.</p>
          </div>
          <small>now</small>
        </div>
      </div>
      <main className="auth-card glass">
        <Logo />
        <p className="eyebrow">YOUR LITTLE CORNER OF CONNECTED</p>
        <h1>
          Good things.
          <br />
          Less noise.
        </h1>
        <p>
          A quieter home for your notifications.
          <br />
          Your services, your devices, your space.
        </p>
        {configured ? (
          <form onSubmit={submit}>
            <Field
              label="Workspace access key"
              type="password"
              autoComplete="current-password"
              placeholder="Your key to a calmer inbox"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              maxLength={256}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={busy || !key} type="submit">
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <>
                  Open your inbox <ArrowRight size={17} />
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="info-note">
            <KeyRound size={22} />
            <p>
              This workspace needs an access key. Follow the setup instructions in the Brisa
              repository.
            </p>
          </div>
        )}
        <div className="auth-footer">
          <ShieldCheck size={15} />
          Self-hosted. Open source. A little more yours.
        </div>
      </main>
      <a
        className="auth-credit"
        href="https://github.com/muchobien/brisa"
        target="_blank"
        rel="noreferrer"
      >
        A little something by <strong>mucho bien</strong> <ArrowRight size={14} />
      </a>
    </div>
  );
}
function NotificationCard({
  notice,
  index,
  onOpen,
  onRead,
}: {
  notice: Notice;
  index: number;
  onOpen: () => void;
  onRead: () => void;
}) {
  const Icon =
    notice.source === "heartbeat"
      ? Radio
      : notice.source === "grafana"
        ? Activity
        : /backup/i.test(notice.title)
          ? ShieldCheck
          : /deploy/i.test(notice.title)
            ? Code2
            : Bell;
  return (
    <article
      className={`notification-card glass ${!notice.read_at ? "is-unread" : ""}`}
      style={{ "--item-index": Math.min(index, 8) } as React.CSSProperties}
    >
      <button className="notification-main" onClick={onOpen}>
        <span className={`notice-icon color-${notice.topic_color}`}>
          <Icon size={21} />
        </span>
        <span className="notice-content">
          <span className="notice-topline">
            <span className={`topic-label color-${notice.topic_color}`}>{notice.topic_name}</span>
            <span className="notice-time">{relativeTime(notice.created_at)}</span>
          </span>
          <span className="notice-title">
            {notice.title}
            {!notice.read_at && <span className="unread-dot" aria-label="Unread" />}
          </span>
          <span className="notice-body">{notice.body}</span>
          <span className="notice-bottom">
            <span className={`priority priority-${notice.priority}`}>
              {notice.priority === "normal"
                ? "Normal priority"
                : `${notice.priority[0]?.toUpperCase()}${notice.priority.slice(1)} priority`}
            </span>
            <span className="source-label">
              {notice.source === "console"
                ? "Sent from Brisa"
                : notice.source === "grafana"
                  ? "Grafana"
                  : notice.source === "heartbeat"
                    ? "Heartbeat monitor"
                    : "API"}
            </span>
          </span>
        </span>
      </button>
      <div className="notification-actions">
        <IconButton
          label={notice.read_at ? `Mark ${notice.title} unread` : `Mark ${notice.title} read`}
          onClick={onRead}
        >
          {notice.read_at ? <MailOpen size={17} /> : <Check size={17} />}
        </IconButton>
        <IconButton label={`Open ${notice.title}`} onClick={onOpen}>
          <MoreHorizontal size={19} />
        </IconButton>
      </div>
    </article>
  );
}
function CodeBlock({
  code,
  onCopy,
}: {
  code: string;
  onCopy: (message: string, error?: boolean) => void;
}) {
  return (
    <div className="code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <IconButton
        label="Copy to clipboard"
        onClick={() => {
          void navigator.clipboard
            .writeText(code)
            .then(() => onCopy("Copied to clipboard"))
            .catch(() =>
              onCopy("Copy is unavailable in this browser. Select the text to copy it.", true),
            );
        }}
      >
        <Copy size={16} />
      </IconButton>
    </div>
  );
}
function HeartbeatCard({
  heartbeat,
  onCopy,
  onDelete,
}: {
  heartbeat: Heartbeat;
  onCopy: (message: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="heartbeat-card glass">
      <div className="list-card">
        <span className={`tile-icon color-${heartbeat.alerting ? "rose" : "mint"}`}>
          <Radio size={22} />
        </span>
        <div className="list-card-copy">
          <h3>
            {heartbeat.name}
            <span className={`badge ${heartbeat.alerting ? "badge-alert" : ""}`}>
              {heartbeat.alerting
                ? "Missed heartbeat"
                : heartbeat.last_seen_at
                  ? "Checking in"
                  : "Waiting for first ping"}
            </span>
          </h3>
          <p>
            Every {Math.round(heartbeat.interval_seconds / 60)} min ·{" "}
            {Math.round(heartbeat.grace_seconds / 60)} min grace
            {heartbeat.last_seen_at ? ` · Last seen ${relativeTime(heartbeat.last_seen_at)}` : ""}
          </p>
        </div>
        <IconButton label={`Delete ${heartbeat.name}`} onClick={onDelete}>
          <Trash2 size={17} />
        </IconButton>
      </div>
      <CodeBlock
        code={`curl -fsS -X POST '${location.origin}/api/heartbeats/${heartbeat.id}/ping' \\\n  -H 'Authorization: Bearer YOUR_PUBLISHING_KEY'`}
        onCopy={onCopy}
      />
    </div>
  );
}
function CreateDialog({
  kind,
  snapshot,
  currentTopic,
  busy,
  onClose,
  onSubmit,
}: {
  kind: Exclude<Dialog, null>;
  snapshot: Snapshot;
  currentTopic: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const defaultTopic = currentTopic === "all" ? (snapshot.topics[0]?.id ?? "") : currentTopic;
  const [name, setName] = useState(
    kind === "device"
      ? /iPhone/.test(navigator.userAgent)
        ? "My iPhone"
        : /Android/.test(navigator.userAgent)
          ? "My Android"
          : "My browser"
      : "",
  );
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<TopicColor>("violet");
  const [topicId, setTopicId] = useState(defaultTopic);
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [selected, setSelected] = useState(snapshot.topics.map((t) => t.id));
  const [interval, setIntervalMinutes] = useState(5);
  const [url, setUrl] = useState("");
  const titles = {
    topic: "A new little space.",
    compose: "Something to share?",
    token: "Connect something good.",
    device: "A little closer.",
    heartbeat: "Keep a gentle watch.",
  };
  const subtitles = {
    topic: "Give your notifications a topic to call home.",
    compose: "Send a message to your inbox and connected devices.",
    token: "This key can publish to one topic. It cannot read your inbox.",
    device: "Choose which topics this device should listen to.",
    heartbeat: "Brisa sends an alert when your service stops checking in.",
  };
  const topicSelect = (
    <label className="field">
      <span>Topic</span>
      <select required value={topicId} onChange={(e) => setTopicId(e.target.value)}>
        {snapshot.topics.map((t) => (
          <option key={t.id} value={t.id}>
            # {t.name}
          </option>
        ))}
      </select>
    </label>
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input =
      kind === "topic"
        ? { name, description, color }
        : kind === "compose"
          ? { topic_id: topicId, title: name, body, priority, ...(url ? { url } : {}) }
          : kind === "device"
            ? { name, topics: selected }
            : kind === "heartbeat"
              ? { name, topic_id: topicId, interval_seconds: interval * 60, grace_seconds: 120 }
              : { name, topic_id: topicId };
    void onSubmit(input);
  };
  return (
    <Modal title={titles[kind]} description={subtitles[kind]} onClose={onClose}>
      <form onSubmit={submit} className="dialog-form">
        <Field
          label={
            kind === "topic"
              ? "Topic name"
              : kind === "compose"
                ? "Title"
                : kind === "device"
                  ? "Device name"
                  : kind === "heartbeat"
                    ? "Monitor name"
                    : "Key name"
          }
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={kind === "compose" ? 120 : kind === "topic" ? 40 : 60}
          pattern={kind === "topic" ? "[a-z0-9]+(-[a-z0-9]+)*" : undefined}
          placeholder={
            kind === "topic"
              ? "e.g. deployments"
              : kind === "compose"
                ? "Your backup is ready"
                : kind === "token"
                  ? "e.g. Grafana on Vega"
                  : kind === "heartbeat"
                    ? "e.g. Vega"
                    : ""
          }
          hint={kind === "topic" ? "Lowercase words, separated by hyphens." : undefined}
        />
        {kind === "topic" && (
          <>
            <Field
              label="Description"
              placeholder="What settles here?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={160}
            />
            <fieldset className="color-picker">
              <legend>A little color</legend>
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch color-${c} ${color === c ? "selected" : ""}`}
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                >
                  {color === c && <Check size={17} />}
                </button>
              ))}
            </fieldset>
          </>
        )}
        {(kind === "compose" || kind === "token" || kind === "heartbeat") && topicSelect}
        {kind === "compose" && (
          <>
            <label className="field">
              <span>Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="A little more detail…"
                maxLength={1800}
                rows={4}
              />
            </label>
            <div className="form-columns">
              <label className="field">
                <span>Priority</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  {(["low", "normal", "high", "urgent"] as const).map((p) => (
                    <option value={p} key={p}>
                      {p[0]?.toUpperCase()}
                      {p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Link (optional)"
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </>
        )}
        {kind === "heartbeat" && (
          <>
            <Field
              label="Expected interval (minutes)"
              type="number"
              min={1}
              max={10080}
              value={interval}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              required
            />
            <p className="form-hint">
              Includes a 2-minute grace period. Monitoring starts as soon as you create it.
            </p>
          </>
        )}
        {kind === "device" && (
          <>
            <fieldset className="topic-checks">
              <legend>Follow these topics</legend>
              {snapshot.topics.map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(t.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, t.id]
                          : selected.filter((id) => id !== t.id),
                      )
                    }
                  />
                  <span className={`topic-dot color-${t.color}`} />
                  {t.name}
                </label>
              ))}
            </fieldset>
            <p className="form-hint">
              On iPhone, open Brisa from your Home Screen first. Your device’s notification settings
              and Focus modes apply.
            </p>
            {!snapshot.pushConfigured && (
              <p className="form-error">Push keys are not configured on this server.</p>
            )}
          </>
        )}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || (kind === "device" && (!selected.length || !snapshot.pushConfigured))}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : kind === "compose" ? (
              <Send size={16} />
            ) : (
              <Plus size={16} />
            )}
            {kind === "compose"
              ? "Send notification"
              : kind === "device"
                ? "Enable notifications"
                : kind === "token"
                  ? "Create key"
                  : kind === "heartbeat"
                    ? "Start watching"
                    : "Create topic"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
