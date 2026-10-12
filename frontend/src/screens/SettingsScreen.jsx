import { Route, Routes, useNavigate } from "react-router-dom";
import MasterSettings from "../portal/MasterSettings.jsx";
import SendingSchedule from "./SendingSchedule.jsx";
import { ClockIcon, GearIcon } from "../portal/Icons.jsx";
import { ScreenTabs } from "./ScreenParts.jsx";

const PATHS = { users: "/users", audit: "/audit", sending: "/settings/sending", wati: "/wati" };

/** Settings (super admin): portal-wide Master Settings, and when reports go out. */
export default function SettingsScreen({ onSaved }) {
  const navigate = useNavigate();
  return (
    <div className="portal-screen">
      <ScreenTabs
        tabs={[
          { to: "/settings", end: true, label: "Master Settings", Icon: GearIcon },
          { to: "/settings/sending", label: "Sending schedule", Icon: ClockIcon },
        ]}
      />
      <Routes>
        <Route index element={<MasterSettings onNavigate={(v) => PATHS[v] && navigate(PATHS[v])} onSaved={onSaved} />} />
        <Route path="sending" element={<SendingSchedule />} />
      </Routes>
    </div>
  );
}
