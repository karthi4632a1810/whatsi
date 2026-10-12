import { NavLink } from "react-router-dom";

/** The page title block every portal screen starts with. */
export function ScreenHeader({ title, subtitle, children }) {
  return (
    <div className="section-header section-header-flex">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
      </div>
      {children ? <div className="section-header-actions">{children}</div> : null}
    </div>
  );
}

/** Sub-screens of one menu item, as the portal's segmented tabs. tabs: [{ to, label, Icon, end }] */
export function ScreenTabs({ tabs }) {
  return (
    <div className="tabs modern-tabs screen-tabs no-print" role="tablist">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} role="tab" className={({ isActive }) => `tab-btn ${isActive ? "active" : ""}`}>
          {Icon ? <Icon size={16} /> : null}
          <span>{label}</span>
        </NavLink>
      ))}
    </div>
  );
}
