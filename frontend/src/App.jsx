import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api.js";
import Layout from "./components/Layout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OverviewDashboardPage from "./pages/OverviewDashboardPage.jsx";
import HisLabTodayPage from "./pages/DashboardPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import PatientsPage from "./pages/PatientsPage.jsx";
import MessagesPage from "./pages/MessagesPage.jsx";
import WatiOverviewPage from "./pages/WatiOverviewPage.jsx";
import WatiTemplatesPage from "./pages/WatiTemplatesPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import LabSearchPage from "./pages/LabSearchPage.jsx";
import WhatsappMonitorPage from "./pages/WhatsappMonitorPage.jsx";

function PrivateRoute({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<OverviewDashboardPage />} />
        <Route path="his-lab-today" element={<HisLabTodayPage />} />
        <Route path="lab-search" element={<LabSearchPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="monitor" element={<WhatsappMonitorPage />} />
        <Route path="wati" element={<WatiOverviewPage />} />
        <Route path="wati/templates" element={<WatiTemplatesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
