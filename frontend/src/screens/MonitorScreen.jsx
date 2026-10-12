import { Route, Routes } from "react-router-dom";
import WhatsappMonitorPage from "../pages/WhatsappMonitorPage.jsx";
import MessageLog from "./MessageLog.jsx";
import { ChartIcon, HistoryIcon } from "../portal/Icons.jsx";
import { ScreenTabs } from "./ScreenParts.jsx";

/** Monitor: delivery of every OP report sent on WhatsApp, and the raw message log. */
export default function MonitorScreen({ access }) {
  return (
    <div className="portal-screen">
      <ScreenTabs
        tabs={[
          { to: "/monitor", end: true, label: "WhatsApp Monitor", Icon: ChartIcon },
          { to: "/monitor/messages", label: "Message log", Icon: HistoryIcon },
        ]}
      />
      <Routes>
        <Route index element={<WhatsappMonitorPage readOnly={!access.monitor.canAct} canExport={access.exports} />} />
        <Route path="messages" element={<MessageLog canRetry={access.monitor.canAct} />} />
      </Routes>
    </div>
  );
}
