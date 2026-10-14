import { Route, Routes } from "react-router-dom";
import WatiDelivery from "./WatiDelivery.jsx";
import WatiOverview from "./WatiOverview.jsx";
import WatiTemplates from "./WatiTemplates.jsx";
import WatiContacts from "./WatiContacts.jsx";
import { ChartIcon, FilePdfIcon, UsersIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import { ScreenTabs } from "./ScreenParts.jsx";

/** WATI Settings: delivery mode (Off / Test / Live), usage overview, templates, patient contacts. */
export default function WatiSettings({ access }) {
  return (
    <div className="portal-screen">
      <ScreenTabs
        tabs={[
          { to: "/wati", end: true, label: "Delivery", Icon: WhatsAppIcon },
          { to: "/wati/overview", label: "Overview", Icon: ChartIcon },
          { to: "/wati/templates", label: "Templates", Icon: FilePdfIcon },
          { to: "/wati/contacts", label: "Contacts", Icon: UsersIcon },
        ]}
      />
      <Routes>
        <Route index element={<WatiDelivery canEdit={access.wati.canEdit} isSuperAdmin={access.isSuperAdmin} />} />
        <Route path="overview" element={<WatiOverview />} />
        <Route path="templates" element={<WatiTemplates canEdit={access.wati.canEdit} />} />
        <Route path="contacts" element={<WatiContacts canEdit={access.wati.canEdit || access.reports.canSend} />} />
      </Routes>
    </div>
  );
}
