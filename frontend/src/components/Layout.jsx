import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, clearToken } from "../api.js";
import {
  IconContacts,
  IconDashboard,
  IconLab,
  IconLog,
  IconLogout,
  IconQueue,
  IconSearch,
  IconSettings,
  IconTemplate,
  IconWati,
} from "./icons.jsx";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ to: "/dashboard", end: true, label: "Dashboard", Icon: IconDashboard }],
  },
  {
    label: "HIS",
    items: [
      { to: "/his-lab-today", end: true, label: "HIS Lab Today", Icon: IconLab },
      { to: "/lab-search", label: "Lab report search", Icon: IconSearch },
      { to: "/reports", label: "WhatsApp Queue", Icon: IconQueue },
      { to: "/patients", label: "Contacts", Icon: IconContacts },
    ],
  },
  {
    label: "WATI",
    items: [
      { to: "/wati", end: true, label: "WATI Overview", Icon: IconWati },
      { to: "/wati/templates", label: "Templates", Icon: IconTemplate },
      { to: "/messages", label: "Message log", Icon: IconLog },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings", Icon: IconSettings }],
  },
];

const ALL_NAV = NAV_SECTIONS.flatMap((s) => s.items);

function pageTitle(pathname) {
  const item = ALL_NAV.find((n) =>
    n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`)
  );
  return item?.label || "Dashboard";
}

export default function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [refreshes, setRefreshes] = useState([]);

  function logout() {
    clearToken();
    navigate("/login");
  }

  useEffect(() => {
    let cancelled = false;

    async function loadActiveRefreshes() {
      try {
        const data = await api.hisActiveRefreshes();
        if (!cancelled) {
          setRefreshes(Array.isArray(data?.refreshes) ? data.refreshes : []);
        }
      } catch {
        if (!cancelled) setRefreshes([]);
      }
    }

    loadActiveRefreshes();
    const intervalId = window.setInterval(loadActiveRefreshes, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const refreshLabel = useMemo(() => {
    if (!refreshes.length) return "";
    if (refreshes.length > 1) return `HIS sync running · ${refreshes.length} days`;
    const refresh = refreshes[0];
    const done = refresh?.refreshProgress?.chunksDone ?? 0;
    const total = refresh?.refreshProgress?.chunksTotal ?? 0;
    const progress = total > 0 ? `${done}/${total}` : "starting";
    return `HIS sync running · ${refresh.labDay} · ${progress}`;
  }, [refreshes]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            M
          </span>
          <div>
            <h1>MAPIMS Lab</h1>
            <p>WhatsApp delivery</p>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="nav-section">
              <p className="nav-section-label">{section.label}</p>
              {section.items.map(({ to, end, label, Icon }) => (
                <NavLink key={to} to={to} end={end} className="nav-link">
                  <Icon className="nav-icon" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-left">
            <p className="topbar-tag">Lab report delivery via WATI</p>
            <p className="topbar-page">{pageTitle(pathname)}</p>
          </div>
          <div className="topbar-actions">
            {refreshLabel ? (
              <span className="topbar-sync-indicator" role="status" aria-live="polite">
                <span className="topbar-sync-dot" aria-hidden />
                {refreshLabel}
              </span>
            ) : null}
            <button className="btn-ghost" onClick={logout} type="button">
              <IconLogout className="btn-icon" />
              Logout
            </button>
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
