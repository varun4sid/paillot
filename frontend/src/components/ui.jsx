import { Link, useNavigate } from "react-router-dom";
import { clearAuth, getUsername } from "../api.js";

export function Header() {
  const navigate = useNavigate();
  const username = getUsername();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white">P</span>
          Paillier Voting
        </Link>
        {username && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{username}</span>
            <button
              onClick={() => { clearAuth(); navigate("/login"); }}
              className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function Card({ title, subtitle, children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

const BTN = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  dark: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
};

export function Button({ variant = "primary", className = "", ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition disabled:cursor-not-allowed ${BTN[variant]} ${className}`}
    />
  );
}

export function ErrorBox({ children }) {
  if (!children) return null;
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</div>;
}

export function Spinner({ className = "h-4 w-4" }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

/** Scrollable box for a huge base-10 integer, with its digit / bit count. */
export function BigNumber({ label, value, maxHeight = "max-h-40" }) {
  const s = String(value);
  const bits = s === "0" ? 0 : BigInt(s).toString(2).length;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-slate-500">
        <span className="font-medium uppercase tracking-wide">{label}</span>
        <span>{s.length} digits · {bits} bits</span>
      </div>
      <div className={`digits overflow-y-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300 ${maxHeight}`}>
        {s}
      </div>
    </div>
  );
}

export function BarChart({ labels, values }) {
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...values);
  return (
    <div className="space-y-3">
      {labels.map((label, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{label}</span>
            <span className="tabular-nums text-slate-600">
              {values[i]} {total > 0 && <span className="text-slate-400">({Math.round((values[i] / total) * 100)}%)</span>}
            </span>
          </div>
          <div className="h-7 overflow-hidden rounded-md bg-slate-100">
            <div
              className="h-full rounded-md bg-indigo-500 transition-all duration-700"
              style={{ width: `${(values[i] / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
