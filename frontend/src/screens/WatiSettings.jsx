import { Route, Routes } from "react-router-dom";
import WatiOverviewPage from "../pages/WatiOverviewPage.jsx";
import WatiTemplatesPage from "../pages/WatiTemplatesPage.jsx";
import PatientsPage from "../pages/PatientsPage.jsx";
import { ChartIcon, FilePdfIcon, UsersIcon } from "../portal/Icons.jsx";
import { ScreenTabs } from "./ScreenParts.jsx";

/** WATI Settings: the connection and usage, message templates, patient contacts. */
export default function WatiSettings({ access }) {
  return (
    <div className="portal-screen">
      <ScreenTabs
        tabs={[
          { to: "/wati", end: true, label: "Overview", Icon: ChartIcon },
          { to: "/wati/templates", label: "Templates", Icon: FilePdfIcon },
          { to: "/wati/contacts", label: "Contacts", Icon: UsersIcon },
        ]}
      />
      <Routes>
        <Route index element={<div className="legacy"><WatiOverviewPage /></div>} />
        <Route path="templates" element={<div className="legacy"><WatiTemplatesPage canEdit={access.wati.canEdit} /></div>} />
        <Route path="contacts" element={<div className="legacy"><PatientsPage canEdit={access.wati.canEdit || access.reports.canSend} /></div>} />
      </Routes>
    </div>
  );
}
