import { Route, Routes } from "react-router-dom";
import HisLabTodayPage from "../pages/DashboardPage.jsx";
import ReportsPage from "../pages/ReportsPage.jsx";
import { TableViewIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import { ScreenTabs } from "./ScreenParts.jsx";

/** OP Lab Reports: the HIS board for a lab day, and the WhatsApp queue. */
export default function OpLabReports({ access, refreshSeconds }) {
  return (
    <div className="portal-screen">
      <ScreenTabs
        tabs={[
          { to: "/reports", end: true, label: "HIS board", Icon: TableViewIcon },
          { to: "/reports/queue", label: "WhatsApp queue", Icon: WhatsAppIcon },
        ]}
      />
      <Routes>
        <Route index element={<div className="legacy"><HisLabTodayPage canSend={access.reports.canSend} refreshSeconds={refreshSeconds} /></div>} />
        <Route path="queue" element={<div className="legacy"><ReportsPage canSend={access.reports.canSend} /></div>} />
      </Routes>
    </div>
  );
}
