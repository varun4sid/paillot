import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api.js";
import LoginRegister from "./pages/LoginRegister.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import PollProjector from "./pages/PollProjector.jsx";
import VotePage from "./pages/VotePage.jsx";

function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginRegister />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/poll/:id/manage" element={<RequireAuth><PollProjector /></RequireAuth>} />
      <Route path="/poll/:id/vote" element={<VotePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
