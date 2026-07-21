import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components.js";
import { ActivityPage } from "./pages/Activity.js";
import { ApprovalsPage } from "./pages/Approvals.js";
import { CollectionsPage } from "./pages/Collections.js";
import { OverviewPage } from "./pages/Overview.js";
import { PayoutsPage } from "./pages/Payouts.js";
import { PolicyPage } from "./pages/Policy.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="payouts" element={<PayoutsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="policy" element={<PolicyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
