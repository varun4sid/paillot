import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, ErrorBox, Spinner } from "../components/ui.jsx";
import { encryptVoteClientSide } from "../crypto/paillierClient.js";
import { fmtMs, getVoterUuid, hasVoted, markVoted, truncateMiddle } from "../utils.js";

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-slate-50">
      <div className="mx-auto max-w-md px-4 py-6">{children}</div>
    </div>
  );
}

function Notice({ icon, title, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div className="text-4xl">{icon}</div>
      <h2 className="mt-2 text-lg font-semibold">{title}</h2>
      {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

function CryptoRow({ label, value, hint }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500">
        <span className="font-medium">{label}</span>
        {hint && <span>{hint}</span>}
      </div>
      <div className="digits mt-0.5 rounded-md bg-slate-900 px-2 py-1.5 text-xs text-emerald-300">{value}</div>
    </div>
  );
}

export default function VotePage() {
  const { id } = useParams();
  const [poll, setPoll] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState(null);
  const [phase, setPhase] = useState(() => (hasVoted(id) ? "already" : "choose"));
  const [ballot, setBallot] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/polls/${id}`).then(setPoll).catch((e) => setLoadError(e.message));
  }, [id]);

  async function castVote() {
    setError("");
    setPhase("encrypting");
    // Yield one frame so the "Encrypting…" state renders before the BigInt math blocks.
    await new Promise((r) => setTimeout(r, 50));

    const voterUuid = getVoterUuid();
    const enc = encryptVoteClientSide({ n: poll.pub_n, g: poll.pub_g }, choice, poll.base_m);
    setBallot(enc);
    setPhase("submitting");

    try {
      await api(`/polls/${id}/vote`, {
        method: "POST",
        body: {
          voter_uuid: voterUuid,
          ciphertext: enc.ciphertext,
          encryption_time_ms: enc.encryptionTimeMs,
          expansion_ratio: enc.expansionRatio,
        },
      });
      markVoted(id);
      setPhase("done");
    } catch (err) {
      if (err.status === 409) {
        markVoted(id);
        setPhase("already");
      } else {
        setError(err.message);
        setPhase("choose");
      }
    }
  }

  if (loadError) return <Shell><Notice icon="⚠️" title="Poll not available">{loadError}</Notice></Shell>;
  if (!poll) return <Shell><div className="py-20 text-center text-slate-500"><Spinner className="h-6 w-6" /></div></Shell>;

  const full = poll.current_vote_count >= poll.max_votes;

  return (
    <Shell>
      <div className="mb-5">
        <div className="text-xs font-medium uppercase tracking-wide text-indigo-600">Encrypted ballot</div>
        <h1 className="mt-1 text-2xl font-bold leading-tight">{poll.title}</h1>
      </div>

      {phase === "already" && (
        <Notice icon="✅" title="You've already voted">
          This browser has already cast a ballot in this poll.
        </Notice>
      )}

      {phase !== "already" && phase !== "done" && !poll.is_active && (
        <Notice icon="🔒" title="This poll is closed">Voting has ended.</Notice>
      )}

      {phase !== "already" && phase !== "done" && poll.is_active && full && (
        <Notice icon="📦" title="This poll is full">The maximum number of votes has been reached.</Notice>
      )}

      {poll.is_active && !full && (phase === "choose" || phase === "encrypting") && (
        <div className="space-y-3">
          {poll.candidates.map((c, i) => (
            <label key={i}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-white p-4 shadow-sm transition ${
                choice === i ? "border-indigo-500 ring-4 ring-indigo-100" : "border-slate-200"}`}>
              <input type="radio" name="candidate" className="h-5 w-5 accent-indigo-600"
                checked={choice === i} onChange={() => setChoice(i)} disabled={phase !== "choose"} />
              <span className="text-lg font-medium">{c}</span>
            </label>
          ))}

          <ErrorBox>{error}</ErrorBox>

          <Button onClick={castVote} disabled={choice === null || phase !== "choose"} className="w-full py-4 text-lg">
            {phase === "encrypting" ? <><Spinner /> Encrypting on your device…</> : "🔒 Encrypt & Cast Vote"}
          </Button>
          <p className="text-center text-xs text-slate-500">
            Your choice is encrypted on this phone with Paillier encryption. The server only ever sees the ciphertext.
          </p>
        </div>
      )}

      {(phase === "submitting" || phase === "done") && ballot && (
        <div className="space-y-4">
          <div className={`rounded-2xl p-5 text-center text-white shadow ${phase === "done" ? "bg-emerald-600" : "bg-indigo-600"}`}>
            <div className="text-4xl">{phase === "done" ? "✅" : <Spinner className="h-8 w-8" />}</div>
            <div className="mt-2 text-lg font-semibold">{phase === "done" ? "Vote cast!" : "Submitting encrypted ballot…"}</div>
            {phase === "done" && <div className="text-sm opacity-90">You voted for <b>{poll.candidates[choice]}</b></div>}
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Your encrypted ballot</div>
            <CryptoRow label="Plaintext m = 1000^i" value={ballot.plaintext} hint="stays on this phone" />
            <CryptoRow label="Random factor r" value={truncateMiddle(ballot.r, 16, 16)} hint="stays on this phone" />
            <CryptoRow label="Ciphertext c = gᵐ · rⁿ mod n²" value={truncateMiddle(ballot.ciphertext, 20, 20)}
              hint={`${ballot.ciphertext.length} digits → sent`} />
            <div className="flex justify-between text-xs text-slate-500">
              <span>Encryption time: <b>{fmtMs(ballot.encryptionTimeMs)}</b></span>
              <span>Expansion: <b>{ballot.expansionRatio}×</b></span>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
