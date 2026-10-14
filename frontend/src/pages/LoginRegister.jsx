import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, getToken, setAuth } from "../api.js";
import { Button, ErrorBox, Spinner } from "../components/ui.jsx";

export default function LoginRegister() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (getToken()) return <Navigate to="/dashboard" replace />;

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api(`/auth/${mode}`, { method: "POST", body: { username, password } });
      setAuth(res.token, res.username);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-indigo-600 text-2xl font-bold text-white">P</div>
          <h1 className="text-2xl font-bold">Paillier Voting</h1>
          <p className="mt-1 text-sm text-slate-500">Privacy-preserving polls with homomorphic encryption</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
            {["login", "register"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(""); }}
                className={`rounded-md py-1.5 font-medium capitalize ${mode === m ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                {m}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Username</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                minLength={3}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </label>
            <ErrorBox>{error}</ErrorBox>
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Spinner />}
              {mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">Voters don't need an account — they just scan the QR code.</p>
      </div>
    </div>
  );
}
