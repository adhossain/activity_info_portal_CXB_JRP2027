import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth-context.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DatabasesPage } from "./pages/DatabasesPage.js";
import { FormsPage } from "./pages/FormsPage.js";
import { RecordsPage } from "./pages/RecordsPage.js";
import { RecordViewPage } from "./pages/RecordViewPage.js";
import { RecordEditPage } from "./pages/RecordEditPage.js";

export function App() {
  const { loading, email } = useAuth();

  if (loading) {
    return <div className="loading">Loading…</div>;
  }

  if (!email) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DatabasesPage />} />
        <Route path="/db/:databaseId" element={<FormsPage />} />
        <Route path="/form/:formId" element={<RecordsPage />} />
        <Route path="/form/:formId/new" element={<RecordEditPage />} />
        <Route path="/form/:formId/record/:recordId" element={<RecordViewPage />} />
        <Route path="/form/:formId/record/:recordId/edit" element={<RecordEditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
