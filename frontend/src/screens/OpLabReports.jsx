import { Route, Routes } from "react-router-dom";
import HisBoard from "./HisBoard.jsx";
import WhatsappQueue from "./WhatsappQueue.jsx";
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
        <Route index element={<HisBoard canSend={access.reports.canSend} refreshSeconds={refreshSeconds} />} />
        <Route path="queue" element={<WhatsappQueue canSend={access.reports.canSend} />} />
      </Routes>
    </div>
  );
}
