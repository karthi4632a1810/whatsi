import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AUTH_EXPIRED_EVENT, MUST_CHANGE_PASSWORD_EVENT, api, clearToken, getToken, setToken } from "./api.js";
import { accessFor, canOpen, firstOpenView } from "./portal/access.js";
import { startAudit, stopAudit, track } from "./portal/audit.js";
import { HOSPITAL } from "./portal/hospital.js";
import LoginScreen from "./portal/LoginScreen.jsx";
import SetPasswordScreen from "./portal/SetPasswordScreen.jsx";
import ProfileMenu from "./portal/ProfileMenu.jsx";
import UserManagement from "./portal/UserManagement.jsx";
import AuditLog from "./portal/AuditLog.jsx";
import LabFinder from "./portal/LabFinder.jsx";
import OpLabReports from "./screens/OpLabReports.jsx";
import LabSearchScreen from "./screens/LabSearchScreen.jsx";
import WatiSettings from "./screens/WatiSettings.jsx";
import MonitorScreen from "./screens/MonitorScreen.jsx";
import SettingsScreen from "./screens/SettingsScreen.jsx";
import {
  ChartIcon,
  ClockIcon,
  CloseIcon,
  FilePdfIcon,
  FlaskIcon,
  GearIcon,
  HospitalIcon,
  LockIcon,
  MegaphoneIcon,
  SearchIcon,
  ShieldCheckIcon,
  UsersIcon,
  WhatsAppIcon,
} from "./portal/Icons.jsx";

/** Top menu, in order: view id (= permission screen), address, label, icon. */
const VIEWS = [
  ["reports", "/reports", "OP Lab Reports", FilePdfIcon],
  ["search", "/lab-search", "Lab Search", SearchIcon],
  ["labFinder", "/lab-finder", "Lab Finder", FlaskIcon],
  ["wati", "/wati", "WATI Settings", WhatsAppIcon],
  ["monitor", "/monitor", "Monitor", ChartIcon],
  ["audit", "/audit", "Audit Log", ShieldCheckIcon],
  ["users", "/users", "Users", UsersIcon],
  ["settings", "/settings", "Settings", GearIcon],
];
const PATH_OF = Object.fromEntries(VIEWS.map(([id, path]) => [id, path]));
const viewOfPath = (pathname) => VIEWS.find(([, path]) => pathname === path || pathname.startsWith(`${path}/`))?.[0] || null;

const ME_KEY = "whatsi-me";
const APP_KEY = "whatsi-app";
function stored(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function keep(key, value) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

/**
 * Master Settings → "Sign out after no activity": no mouse / keyboard in any
 * tab for `minutes` signs out, with a one-minute warning.
 */
const ACTIVITY_KEY = "whatsi_last_activity";
function useIdleSignOut(minutes, onSignOut) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  useEffect(() => {
    if (!minutes) {
      setSecondsLeft(null);
      return undefined;
    }
    let last = Date.now();
    let lastShared = 0;
    const mark = () => {
      last = Date.now();
      if (last - lastShared > 5000) {
        lastShared = last;
        try {
          localStorage.setItem(ACTIVITY_KEY, String(last));
        } catch {
          // ignore storage errors
        }
      }
    };
    mark();
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true, capture: true }));
    const timer = setInterval(() => {
      let shared = 0;
      try {
        shared = Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
      } catch {
        // ignore storage errors
      }
      const left = minutes * 60_000 - (Date.now() - Math.max(last, shared));
      if (left <= 0) {
        clearInterval(timer);
        onSignOut(minutes);
      } else setSecondsLeft(left <= 60_000 ? Math.ceil(left / 1000) : null);
    }, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, mark, { capture: true }));
    };
  }, [minutes, onSignOut]);
  return secondsLeft;
}

/** The announcement from Master Settings; each text can be hidden once per session. */
function NoticeBanner({ text, tone }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem("whatsi_notice_hidden") || "";
    } catch {
      return "";
    }
  });
  if (!text || hidden === text) return null;
  return (
    <div className={`app-notice is-${tone || "info"} no-print`} role={tone === "danger" ? "alert" : "status"}>
      <MegaphoneIcon size={15} />
      <span>{text}</span>
      <button
        type="button"
        className="app-notice-close"
        aria-label="Hide this announcement"
        onClick={() => {
          setHidden(text);
          try {
            sessionStorage.setItem("whatsi_notice_hidden", text);
          } catch {
            // ignore storage errors
          }
        }}
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

/** A screen the user may open, or their first allowed one. */
function Guard({ me, view, children }) {
  if (canOpen(me, view)) return children;
  const first = firstOpenView(me);
  return first ? <Navigate to={PATH_OF[first]} replace /> : null;
}

export default function App() {
  const location = useLocation();
  const [me, setMe] = useState(() => (getToken() ? stored(ME_KEY) : null));
  const [appSettings, setAppSettings] = useState(() => stored(APP_KEY) || {});
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  // The password just typed, kept only while a temporary one must be replaced.
  const [tempPassword, setTempPassword] = useState("");
  const refreshSessionRef = useRef(() => {});
  const isAuthenticated = Boolean(me);
  const access = accessFor(me);
  const view = viewOfPath(location.pathname);

  const applyMe = useCallback((user, app) => {
    if (user) {
      keep(ME_KEY, user);
      setMe(user);
    }
    if (app) {
      keep(APP_KEY, app);
      setAppSettings(app);
    }
  }, []);

  const expire = useCallback((reason) => {
    stopAudit();
    clearToken();
    keep(ME_KEY, null);
    setMe(null);
    setPassword("");
    setLoginError(reason || "Your session has ended — please sign in again.");
  }, []);

  // The token is what grants access; the stored profile only remembers the UI
  // state. Re-read it on load, every minute and when the tab comes back, so
  // permission and Master Settings changes show up without a reload.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refresh = () =>
      api
        .me()
        .then(({ user, app }) => applyMe(user, app))
        .catch(() => {});
    refresh();
    refreshSessionRef.current = refresh;
    const onExpired = (e) => expire(e.detail?.reason);
    const onFocus = () => !document.hidden && refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener(MUST_CHANGE_PASSWORD_EVENT, refresh);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
      window.removeEventListener(MUST_CHANGE_PASSWORD_EVENT, refresh);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isAuthenticated, applyMe, expire]);

  // Audit log (portal/audit.js): this browser's screens and idle time.
  const viewRef = useRef(view);
  const screenSince = useRef({ view, at: Date.now() });
  useEffect(() => {
    if (!me?.username) return undefined;
    startAudit(() => viewRef.current);
    return () => stopAudit();
  }, [me?.username]);
  useEffect(() => {
    viewRef.current = view;
    if (!me?.username || !view) return;
    const prev = screenSince.current;
    if (prev.view === view && prev.logged) return;
    track("screen_open", { screen: view, details: prev.view && prev.view !== view ? { from: prev.view, prevMs: Date.now() - prev.at } : undefined });
    screenSince.current = { view, at: Date.now(), logged: true };
  }, [view, me?.username]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const data = await api.login(username, password);
      setToken(data.token);
      setTempPassword(data.user.mustChangePassword ? password : "");
      applyMe(data.user, data.app);
      setPassword("");
    } catch (err) {
      setLoginError(err.message || "Sign-in failed");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout(reason = "") {
    stopAudit();
    api.logout();
    clearToken();
    keep(ME_KEY, null);
    setMe(null);
    setUsername("");
    setPassword("");
    setLoginError(typeof reason === "string" ? reason : "");
  }

  const idleMinutes = isAuthenticated ? Number(appSettings["auth.idleSignOutMinutes"]) || 0 : 0;
  const idleSignOutRef = useRef(null);
  idleSignOutRef.current = (minutes) => handleLogout(`Signed out after ${minutes} minutes without activity. Please sign in again.`);
  const onIdle = useRef((minutes) => idleSignOutRef.current(minutes)).current;
  const idleSecondsLeft = useIdleSignOut(idleMinutes, onIdle);

  if (!isAuthenticated) {
    return (
      <LoginScreen
        hospital={HOSPITAL}
        username={username}
        password={password}
        loading={loginLoading}
        error={loginError}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={handleLogin}
      />
    );
  }

  if (me.mustChangePassword) {
    return (
      <SetPasswordScreen
        me={me}
        tempPassword={tempPassword}
        onLogout={handleLogout}
        onDone={async () => {
          setTempPassword("");
          const { user, app } = await api.me();
          applyMe(user, app);
        }}
      />
    );
  }

  const first = firstOpenView(me);
  const refreshSeconds = Number(appSettings["board.refreshSeconds"]) || 15;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <div className="app-brand-icon">
            <HospitalIcon size={24} />
          </div>
          <div className="app-brand-text">
            <div className="app-brand-title">{HOSPITAL.nameEn}</div>
            <div className="app-brand-subtitle">
              <span>OP Lab Reports · WhatsApp</span>
              <span className="brand-badge-pill">AOSTA</span>
            </div>
          </div>
        </div>

        <div className="page-header-actions">
          <nav className="nav-segmented-control no-print" aria-label="Main Navigation">
            {VIEWS.filter(([id]) => canOpen(me, id)).map(([id, path, label, Icon]) => (
              <NavLink key={id} to={path} className={({ isActive }) => `nav-segment-btn ${isActive ? "active" : ""}`} title={label} aria-label={label}>
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <ProfileMenu me={me} onLogout={handleLogout} />
        </div>
      </header>

      <main className="page">
        <NoticeBanner text={appSettings["notice.text"]} tone={appSettings["notice.tone"]} />
        {appSettings["maintenance.readOnly"] && (
          <div className="app-notice is-readonly no-print" role="status">
            <LockIcon size={14} />
            {me.isSuperAdmin ? (
              <span>
                <b>Read-only mode is on</b> for staff — they can view but not send, download or change anything, and automatic sending is paused. You
                still have full access.{" "}
                <NavLink className="app-notice-link" to="/settings">
                  Master Settings
                </NavLink>
              </span>
            ) : (
              <span>
                <b>Read-only mode</b> — the portal is under maintenance. You can view everything; sending, downloads and changes are paused.
              </span>
            )}
          </div>
        )}
        {idleSecondsLeft !== null && (
          <div className="app-idle-warning" role="alert">
            <ClockIcon size={16} />
            <span>
              No activity — you’ll be signed out in <b>{idleSecondsLeft} s</b>.
            </span>
            <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new Event("mousedown"))}>
              Stay signed in
            </button>
          </div>
        )}

        {!first && (
          <div className="no-access">
            <LockIcon size={28} />
            <b>Your account has no screens yet</b>
            <span>Ask the super admin to give you access.</span>
          </div>
        )}

        <Routes>
          <Route path="/" element={first ? <Navigate to={PATH_OF[first]} replace /> : null} />
          <Route path="/reports/*" element={<Guard me={me} view="reports"><OpLabReports access={access} refreshSeconds={refreshSeconds} /></Guard>} />
          <Route path="/lab-search" element={<Guard me={me} view="search"><LabSearchScreen canQueue={access.reports.canSend} canChangeMode={access.wati.canEdit} /></Guard>} />
          <Route path="/lab-finder" element={<Guard me={me} view="labFinder"><LabFinder canDownload={access.exports} /></Guard>} />
          <Route path="/wati/*" element={<Guard me={me} view="wati"><WatiSettings access={access} /></Guard>} />
          <Route path="/monitor/*" element={<Guard me={me} view="monitor"><MonitorScreen access={access} /></Guard>} />
          <Route path="/audit" element={<Guard me={me} view="audit"><AuditLog canExport={access.exports} /></Guard>} />
          <Route path="/users" element={<Guard me={me} view="users"><UserManagement /></Guard>} />
          <Route path="/settings/*" element={<Guard me={me} view="settings"><SettingsScreen onSaved={() => refreshSessionRef.current()} /></Guard>} />
          {/* Addresses from the earlier sidebar layout */}
          <Route path="/dashboard" element={<Navigate to="/reports" replace />} />
          <Route path="/his-lab-today" element={<Navigate to="/reports" replace />} />
          <Route path="/patients" element={<Navigate to="/wati/contacts" replace />} />
          <Route path="/messages" element={<Navigate to="/monitor/messages" replace />} />
          <Route path="/login" element={first ? <Navigate to={PATH_OF[first]} replace /> : null} />
          <Route path="*" element={first ? <Navigate to={PATH_OF[first]} replace /> : null} />
        </Routes>
      </main>
    </div>
  );
}
