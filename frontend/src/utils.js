/* global __LAN_ORIGIN__ */

/**
 * RFC 4122 v4 UUID. crypto.randomUUID() only exists in secure contexts
 * (HTTPS / localhost); phones opening http://<laptop-ip>:5173 need the fallback.
 */
export function uuidv4() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

export function getVoterUuid() {
  let id = lsGet("voter_uuid");
  if (!id) {
    id = uuidv4();
    lsSet("voter_uuid", id);
  }
  return id;
}

export const hasVoted = (pollId) => lsGet(`voted_${pollId}`) === "1";
export const markVoted = (pollId) => lsSet(`voted_${pollId}`, "1");

// --- Private key handling (never sent to the server) -----------------------

const privKeyName = (pollId) => `paillier_priv_${pollId}`;

export function savePrivateKey(pollId, privateKey) {
  lsSet(privKeyName(pollId), JSON.stringify(privateKey));
}

export function loadPrivateKey(pollId) {
  const raw = lsGet(privKeyName(pollId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Accepts the downloaded backup file format or a bare {lambda, mu, n} object. */
export function parsePrivateKeyFile(text) {
  const obj = JSON.parse(text);
  const key = obj.private_key || obj;
  if (!key.lambda || !key.mu || !key.n) throw new Error("File does not contain lambda, mu and n");
  return { lambda: String(key.lambda), mu: String(key.mu), n: String(key.n) };
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- QR origin ----------------------------------------------------------------

const isLocalHost = (h) => ["localhost", "127.0.0.1", "[::1]"].includes(h);

/** Origin phones should use: the laptop's LAN address when the presenter is on localhost. */
export function defaultVoteOrigin() {
  const saved = lsGet("qr_origin");
  if (saved) return saved;
  return isLocalHost(window.location.hostname) ? __LAN_ORIGIN__ : window.location.origin;
}

export const saveVoteOrigin = (origin) => lsSet("qr_origin", origin);

// --- Formatting ------------------------------------------------------------------

export function truncateMiddle(s, head = 12, tail = 12) {
  s = String(s);
  return s.length <= head + tail + 3 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function fmtMs(ms, digits = 2) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)} µs`;
  return `${Number(ms).toFixed(digits)} ms`;
}
