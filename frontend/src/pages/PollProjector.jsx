import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api.js";
import { BarChart, BigNumber, Button, Card, ErrorBox, Header, Spinner } from "../components/ui.jsx";
import {
  bitLength, decryptTally, encrypt, encryptVoteClientSide, expansionRatio, verifyIntegrity,
} from "../crypto/paillierClient.js";
import {
  defaultVoteOrigin, downloadJson, fmtMs, loadPrivateKey, parsePrivateKeyFile,
  savePrivateKey, saveVoteOrigin, truncateMiddle, uuidv4,
} from "../utils.js";

const POLL_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function StepBadge({ n, done }) {
  return (
    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
      done ? "bg-emerald-500 text-white" : "bg-indigo-100 text-indigo-700"}`}>
      {done ? "✓" : n}
    </span>
  );
}

function Metric({ label, value, detail }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </div>
  );
}

/** Shows M_total split into Base-1000 buckets, highest candidate on the left. */
function Buckets({ mTotal, candidates, leftover }) {
  const s = mTotal.toString();
  const k = candidates.length;
  const padded = s.padStart(3 * k, "0");
  const lowDigits = padded.slice(-3 * k);
  const groups = [];
  for (let i = k - 1; i >= 0; i--) {
    const start = (k - 1 - i) * 3;
    groups.push({ i, digits: lowDigits.slice(start, start + 3) });
  }
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {leftover !== "0" && (
        <div className="text-center">
          <div className="rounded-md bg-rose-600 px-2 py-1.5 font-mono text-lg font-bold text-white">{leftover}</div>
          <div className="mt-1 text-[10px] font-medium text-rose-600">overflow!</div>
        </div>
      )}
      {groups.map(({ i, digits }) => (
        <div key={i} className="text-center">
          <div className="rounded-md bg-indigo-600 px-2 py-1.5 font-mono text-lg font-bold text-white">{digits}</div>
          <div className="mt-1 max-w-16 truncate text-[10px] text-slate-500" title={candidates[i]}>
            1000<sup>{i}</sup> · {candidates[i]}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PollProjector() {
  const { id } = useParams();
  const [poll, setPoll] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [voteOrigin, setVoteOrigin] = useState(defaultVoteOrigin);
  const [editingOrigin, setEditingOrigin] = useState(false);

  const [privateKey, setPrivateKey] = useState(() => loadPrivateKey(id));
  const [keyError, setKeyError] = useState("");

  const [demoChoice, setDemoChoice] = useState(0);
  const [demo, setDemo] = useState(null);
  const [simN, setSimN] = useState(10);
  const [sim, setSim] = useState(null);           // { done, total }
  const [castHere, setCastHere] = useState(null); // per-candidate counts cast from this screen
  const [toolBusy, setToolBusy] = useState("");
  const [toolError, setToolError] = useState("");

  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [decrypting, setDecrypting] = useState(false);
  const [result, setResult] = useState(null);

  const refresh = useCallback(
    () => api(`/polls/${id}`).then(setPoll).catch((e) => setLoadError(e.message)),
    [id]
  );

  useEffect(() => { refresh(); }, [refresh]);

  // Live vote counter while the poll is open.
  useEffect(() => {
    if (!poll?.is_active) return;
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [poll?.is_active, refresh]);

  if (loadError) {
    return <><Header /><main className="mx-auto max-w-3xl p-6"><ErrorBox>{loadError}</ErrorBox></main></>;
  }
  if (!poll) {
    return <><Header /><div className="py-24 text-center text-slate-500"><Spinner className="h-6 w-6" /></div></>;
  }

  const k = poll.candidates.length;
  const voteUrl = `${voteOrigin.replace(/\/$/, "")}/poll/${poll.id}/vote`;
  const remaining = poll.max_votes - poll.current_vote_count;
  const keyBits = bitLength(BigInt(poll.pub_n));
  const pub = { n: poll.pub_n, g: poll.pub_g };

  // --- casting ballots from the presenter screen ------------------------------

  function noteCast(indices) {
    setCastHere((prev) => {
      const next = prev ? [...prev] : Array(k).fill(0);
      for (const i of indices) next[i] += 1;
      return next;
    });
  }

  /** Encrypt in the browser and submit with a fresh voter UUID (like a new phone). */
  async function submitBallot(index, plaintextOverride) {
    let enc;
    if (plaintextOverride === undefined) {
      enc = encryptVoteClientSide(pub, index, poll.base_m);
    } else {
      const t0 = performance.now();
      const { c, r } = encrypt(pub, plaintextOverride);
      enc = { ciphertext: c.toString(), r: r.toString(), plaintext: plaintextOverride.toString(),
        encryptionTimeMs: performance.now() - t0, expansionRatio: expansionRatio(c) };
    }
    await api(`/polls/${id}/vote`, {
      method: "POST",
      body: { voter_uuid: uuidv4(), ciphertext: enc.ciphertext,
        encryption_time_ms: enc.encryptionTimeMs, expansion_ratio: enc.expansionRatio },
    });
    return enc;
  }

  async function runTool(name, fn) {
    setToolError("");
    setToolBusy(name);
    try { await fn(); } catch (e) { setToolError(e.message); } finally {
      setToolBusy("");
      refresh();
    }
  }

  const castDemoVotes = () => runTool("demo", async () => {
    const i = Number(demoChoice);
    const a = await submitBallot(i);
    noteCast([i]);
    const b = await submitBallot(i);
    noteCast([i]);
    setDemo({ candidate: i, ballots: [a, b] });
  });

  const simulateVotes = () => runTool("sim", async () => {
    const total = Math.min(Number(simN), remaining);
    const queue = Array.from({ length: total }, () => Math.floor(Math.random() * k));
    let done = 0;
    setSim({ done, total });
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift();
        await submitBallot(i);
        noteCast([i]);
        setSim({ done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  });

  const castTamperedBallot = () => runTool("tamper", async () => {
    // One row that secretly carries 5 votes for candidate 0 (m = 5 instead of 1000^i).
    await submitBallot(0, 5n);
  });

  // --- close & decrypt --------------------------------------------------------

  async function closePoll() {
    if (!window.confirm("Close the poll? No more votes will be accepted.")) return;
    setCloseError("");
    setClosing(true);
    try {
      setPoll(await api(`/polls/${id}/close`, { method: "POST", auth: true }));
    } catch (e) {
      setCloseError(e.message);
    } finally {
      setClosing(false);
    }
  }

  async function onKeyFile(e) {
    setKeyError("");
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const key = parsePrivateKeyFile(await file.text());
      if (key.n !== poll.pub_n) throw new Error("This private key belongs to a different poll (n does not match).");
      savePrivateKey(id, key);
      setPrivateKey(key);
    } catch (err) {
      setKeyError(err.message);
    }
    e.target.value = "";
  }

  async function decryptLocally() {
    setKeyError("");
    if (privateKey.n !== poll.pub_n) {
      setKeyError("The stored private key does not match this poll's public key.");
      return;
    }
    setDecrypting(true);
    await new Promise((r) => setTimeout(r, 50));
    const { mTotal, decryptionTimeMs } = decryptTally(privateKey, poll.encrypted_tally);
    const integrity = verifyIntegrity(mTotal, k, poll.current_vote_count, poll.base_m);
    setResult({ mTotal, decryptionTimeMs, ...integrity });
    setDecrypting(false);
  }

  const closed = !poll.is_active;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {/* ------------------------------------------------------------ Top */}
        <Card>
          <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
            <div className="mx-auto w-full max-w-72 rounded-2xl border border-slate-200 bg-white p-3">
              <QRCodeSVG value={voteUrl} size={512} marginSize={1} className={`h-auto w-full ${closed ? "opacity-25" : ""}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${closed ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {closed ? "Closed" : "● Live"}
                </span>
                <span className="text-xs text-slate-500">{keyBits}-bit Paillier key</span>
              </div>
              <h1 className="mt-2 text-3xl font-bold md:text-4xl">{poll.title}</h1>
              <p className="mt-1 text-slate-600">{poll.candidates.join(" · ")}</p>

              <div className="mt-5 text-sm font-medium uppercase tracking-wide text-slate-500">Votes cast</div>
              <div className="text-6xl font-bold tabular-nums text-indigo-600 md:text-7xl">
                {poll.current_vote_count}<span className="text-3xl text-slate-400"> / {poll.max_votes}</span>
              </div>

              <div className="mt-4 text-sm">
                {editingOrigin ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveVoteOrigin(voteOrigin); setEditingOrigin(false); }}>
                    <input className="flex-1 rounded-lg border border-slate-300 px-2 py-1 font-mono text-xs" value={voteOrigin}
                      onChange={(e) => setVoteOrigin(e.target.value)} />
                    <Button type="submit" variant="secondary" className="px-3 py-1 text-xs">Save</Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={voteUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-indigo-600 underline">{voteUrl}</a>
                    <button onClick={() => setEditingOrigin(true)} className="text-xs text-slate-500 hover:text-slate-800">edit host</button>
                  </div>
                )}
                {/localhost|127\.0\.0\.1/.test(voteOrigin) && (
                  <p className="mt-1 text-xs text-amber-600">⚠ Phones can't reach "localhost" — set the host to your laptop's network IP.</p>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ------------------------------------------------- Demo tools */}
          <Card title="Presenter demo tools" subtitle="Ballots are encrypted in this browser exactly like on a phone, each with a fresh voter UUID. They count as real votes.">
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={demoChoice}
                    onChange={(e) => setDemoChoice(e.target.value)} disabled={closed}>
                    {poll.candidates.map((c, i) => <option key={i} value={i}>{c}</option>)}
                  </select>
                  <Button onClick={castDemoVotes} disabled={closed || !!toolBusy || remaining < 2}>
                    {toolBusy === "demo" && <Spinner />} Cast Demo Vote (Test Probabilistic Encryption)
                  </Button>
                </div>
                {demo && (
                  <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                    <div className="text-sm">
                      Two ballots for <b>{poll.candidates[demo.candidate]}</b> (same plaintext m = {demo.ballots[0].plaintext}):
                    </div>
                    {demo.ballots.map((b, j) => (
                      <div key={j} className="text-xs">
                        <span className="font-medium text-slate-500">c{j + 1} = </span>
                        <span className="digits rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">{truncateMiddle(b.ciphertext, 24, 24)}</span>
                      </div>
                    ))}
                    <div className="text-xs font-medium text-emerald-700">
                      {demo.ballots[0].ciphertext !== demo.ballots[1].ciphertext
                        ? "✓ Completely different ciphertexts — check the votes table in Supabase!"
                        : "Identical (should never happen)"}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={1} max={Math.max(1, remaining)} value={simN} onChange={(e) => setSimN(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 px-3 py-2" disabled={closed} />
                  <Button variant="secondary" onClick={simulateVotes} disabled={closed || !!toolBusy || remaining < 1 || simN < 1}>
                    {toolBusy === "sim" && <Spinner />} Simulate random votes
                  </Button>
                </div>
                {sim && (
                  <div className="mt-2">
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(sim.done / sim.total) * 100}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{sim.done} / {sim.total} encrypted &amp; submitted</div>
                  </div>
                )}
              </div>

              {castHere && (
                <div className="text-xs text-slate-500">
                  Cast from this screen: {poll.candidates.map((c, i) => `${c} ${castHere[i]}`).join(" · ")}
                </div>
              )}

              <details className="border-t border-slate-100 pt-4">
                <summary className="cursor-pointer text-sm font-medium text-rose-700">Tamper-detection demo</summary>
                <p className="mt-2 text-xs text-slate-600">
                  Submits a single malicious ballot encrypting m = 5 (instead of a valid 1000<sup>i</sup>), i.e. one row worth 5 votes.
                  Without zero-knowledge proofs the server can't tell — but the post-decryption integrity check will.
                </p>
                <Button variant="danger" className="mt-2 text-sm" onClick={castTamperedBallot} disabled={closed || !!toolBusy || remaining < 1}>
                  {toolBusy === "tamper" && <Spinner />} Cast tampered ballot
                </Button>
              </details>

              <ErrorBox>{toolError}</ErrorBox>
            </div>
          </Card>

          {/* -------------------------------------------- Close & decrypt */}
          <Card title="End poll & decrypt">
            <div className="space-y-6">
              <div className="flex gap-3">
                <StepBadge n={1} done={closed} />
                <div className="min-w-0 flex-1 space-y-3">
                  <Button variant="dark" onClick={closePoll} disabled={closed || closing} className="w-full">
                    {closing && <Spinner />} 1. Close Poll &amp; Compute Homomorphic Tally on Server
                  </Button>
                  <ErrorBox>{closeError}</ErrorBox>
                  {closed && poll.encrypted_tally && (
                    <>
                      <BigNumber label="C_total = ∏ cⱼ mod n² (computed by server)" value={poll.encrypted_tally} />
                      <p className="text-xs text-slate-500">
                        The server multiplied {poll.current_vote_count} ciphertexts in {fmtMs(poll.tally_time_ms, 3)} without
                        ever learning a single vote.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <StepBadge n={2} done={!!result} />
                <div className="min-w-0 flex-1 space-y-3">
                  <Button onClick={decryptLocally} disabled={!closed || !privateKey || decrypting} className="w-full">
                    {decrypting && <Spinner />} 2. Decrypt Tally Locally with Private Key
                  </Button>
                  {privateKey ? (
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>🔑 Private key (λ, μ) loaded from this browser — never sent to the server.</span>
                      <button className="text-indigo-600 hover:underline"
                        onClick={() => downloadJson(`poll_${id}_private_key.json`, { poll_id: id, title: poll.title, private_key: privateKey })}>
                        backup
                      </button>
                    </div>
                  ) : (
                    <label className="block rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-sm">
                      <span className="font-medium text-amber-800">Private key not found in this browser.</span>
                      <span className="block text-xs text-amber-700">Upload poll_{id.slice(0, 8)}…_private_key.json:</span>
                      <input type="file" accept="application/json,.json" onChange={onKeyFile} className="mt-2 block text-xs" />
                    </label>
                  )}
                  <ErrorBox>{keyError}</ErrorBox>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ---------------------------------------------------- Results */}
        {result && (
          <Card title="Decrypted results" subtitle={`M_total = L(C_total^λ mod n²) · μ mod n — computed in ${fmtMs(result.decryptionTimeMs)} in this browser`}>
            {result.verified ? (
              <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-800">
                <span className="text-xl">✅</span>
                Integrity Verified: Decrypted sum matches total ballots cast.
              </div>
            ) : (
              <div className="mb-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-rose-800">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="text-xl">🚨</span>
                  Cryptographic Tampering Detected: A malicious voter submitted an out-of-range plaintext!
                </div>
                <div className="mt-1 text-sm">
                  Decoded sum = {result.decodedSum}, ballots in database = {poll.current_vote_count}
                  {!result.inRange && " · M_total ≥ 1000^k (overflow beyond the last candidate bucket)"}
                </div>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Raw decrypted integer M_total</div>
                  <div className="digits text-3xl font-bold">{result.mTotal.toString()}</div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Base-1000 buckets</div>
                  <Buckets mTotal={result.mTotal} candidates={poll.candidates} leftover={result.leftover} />
                </div>
                <div className="text-xs text-slate-500">
                  count[i] = ⌊M_total / 1000<sup>i</sup>⌋ mod 1000 · Σ = {result.decodedSum} / {poll.current_vote_count} ballots
                </div>
              </div>
              <BarChart labels={poll.candidates} values={result.counts} />
            </div>
          </Card>
        )}

        {/* ------------------------------------------------- Benchmarks */}
        {closed && (
          <Card title="Academic benchmarks" subtitle={`${keyBits}-bit modulus n · ciphertexts live in Z*ₙ² (${2 * keyBits} bits)`}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Ciphertext expansion"
                value={poll.avg_expansion_ratio ? `${poll.avg_expansion_ratio.toFixed(0)}×` : "—"}
                detail={poll.avg_expansion_ratio
                  ? `~${Math.round(poll.avg_expansion_ratio * 8)} B ciphertext vs 8 B plaintext integer`
                  : "No ballots"}
              />
              <Metric
                label="Avg client encryption"
                value={fmtMs(poll.avg_encryption_time_ms)}
                detail="gᵐ · rⁿ mod n² per ballot, in the voter's browser"
              />
              <Metric
                label="Server homomorphic tally"
                value={fmtMs(poll.tally_time_ms, 3)}
                detail={<>vs plaintext sum {fmtMs(poll.plaintext_time_ms, 4)}
                  {poll.plaintext_time_ms > 0 && poll.tally_time_ms > 0 &&
                    <> · <b>{Math.round(poll.tally_time_ms / poll.plaintext_time_ms)}× slower</b></>}</>}
              />
              <Metric
                label="Client decryption"
                value={result ? fmtMs(result.decryptionTimeMs) : "—"}
                detail={result ? "L(C^λ mod n²) · μ mod n, in this browser" : "Run step 2 to measure"}
              />
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
