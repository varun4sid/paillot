import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, ErrorBox, Header, Spinner } from "../components/ui.jsx";
import { MAX_CANDIDATES, MAX_VOTES } from "../crypto/paillierClient.js";
import { downloadJson, loadPrivateKey, savePrivateKey } from "../utils.js";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

function CreatePollForm({ onCreated }) {
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState(["", ""]);
  const [maxVotes, setMaxVotes] = useState(50);
  const [keyBits, setKeyBits] = useState(512);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setCandidate = (i, v) => setCandidates((cs) => cs.map((c, j) => (j === i ? v : c)));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const poll = await api("/polls", {
        method: "POST",
        auth: true,
        body: { title, candidates, max_votes: Number(maxVotes), key_bits: Number(keyBits) },
      });
      // Trust boundary: the private key exists only in this browser + the backup file.
      savePrivateKey(poll.id, poll.private_key);
      downloadJson(`poll_${poll.id}_private_key.json`, {
        poll_id: poll.id,
        title: poll.title,
        key_bits: poll.key_bits,
        created_at: poll.created_at,
        private_key: poll.private_key,
      });
      onCreated(poll);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Poll title</span>
        <input className={`${inputCls} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Best programming language" required maxLength={200} />
      </label>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Candidates</span>
          <span className="text-xs text-slate-500">{candidates.length} / {MAX_CANDIDATES}</span>
        </div>
        <div className="mt-1 space-y-2">
          {candidates.map((c, i) => (
            <div key={i} className="flex gap-2">
              <span className="grid w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-mono text-slate-500">{i}</span>
              <input className={inputCls} value={c} onChange={(e) => setCandidate(i, e.target.value)}
                placeholder={`Candidate ${i + 1}`} required maxLength={60} />
              <button type="button" disabled={candidates.length <= 2}
                onClick={() => setCandidates((cs) => cs.filter((_, j) => j !== i))}
                className="rounded-lg px-3 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-30"
                aria-label="Remove candidate">✕</button>
            </div>
          ))}
        </div>
        {candidates.length < MAX_CANDIDATES && (
          <button type="button" onClick={() => setCandidates((cs) => [...cs, ""])}
            className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800">+ Add candidate</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium">Max expected votes</span>
          <input type="number" className={`${inputCls} mt-1`} min={1} max={MAX_VOTES} value={maxVotes}
            onChange={(e) => setMaxVotes(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Key size</span>
          <select className={`${inputCls} mt-1 bg-white`} value={keyBits} onChange={(e) => setKeyBits(e.target.value)}>
            <option value={512}>512-bit (Fast Demo)</option>
            <option value={1024}>1024-bit (Standard)</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-slate-500">
        Votes are Base-1000 encoded (candidate <i>i</i> → 1000<sup><i>i</i></sup>), so each candidate can hold up to {MAX_VOTES} votes.
        After creating the poll, your <b>private key</b> is saved in this browser and downloaded as a backup file. It is never stored on the server.
      </p>

      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? <><Spinner /> Generating {keyBits}-bit Paillier keypair…</> : "Create poll & generate keys"}
      </Button>
    </form>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [polls, setPolls] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/polls", { auth: true }).then(setPolls).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <Header />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_1.1fr]">
        <Card title="Create a new poll" subtitle="A fresh Paillier keypair is generated for every poll.">
          <CreatePollForm onCreated={(poll) => navigate(`/poll/${poll.id}/manage`)} />
        </Card>

        <Card title="Your polls">
          <ErrorBox>{error}</ErrorBox>
          {polls === null && !error && <div className="text-slate-500"><Spinner /> Loading…</div>}
          {polls?.length === 0 && <p className="text-sm text-slate-500">No polls yet. Create one to get started.</p>}
          <ul className="divide-y divide-slate-100">
            {polls?.map((p) => {
              const hasKey = !!loadPrivateKey(p.id);
              return (
                <li key={p.id}>
                  <Link to={`/poll/${p.id}/manage`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {p.candidates.length} candidates · {p.current_vote_count}/{p.max_votes} votes ·{" "}
                        {new Date(p.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <span title={hasKey ? "Private key stored in this browser" : "Private key not in this browser — upload the backup file to decrypt"}
                        className={hasKey ? "text-emerald-600" : "text-amber-600"}>
                        {hasKey ? "🔑 key" : "⚠ no key"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${p.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {p.is_active ? "Active" : "Closed"}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </main>
    </>
  );
}
