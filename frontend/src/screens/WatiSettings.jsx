import { Route, Routes } from "react-router-dom";
import WatiOverview from "./WatiOverview.jsx";
import WatiTemplates from "./WatiTemplates.jsx";
import WatiContacts from "./WatiContacts.jsx";
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
        <Route index element={<WatiOverview />} />
        <Route path="templates" element={<WatiTemplates canEdit={access.wati.canEdit} />} />
        <Route path="contacts" element={<WatiContacts canEdit={access.wati.canEdit || access.reports.canSend} />} />
      </Routes>
    </div>
  );
}
