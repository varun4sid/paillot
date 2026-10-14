// Small bridge so the Python cross-language test can call the real frontend
// crypto module. Reads a JSON command on stdin, writes a JSON result to stdout.
import { encryptVoteClientSide, decryptTally, decodeTally, verifyIntegrity } from
  "../../frontend/src/crypto/paillierClient.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const cmd = JSON.parse(input);

let out;
if (cmd.op === "encrypt") {
  out = cmd.votes.map((i) => encryptVoteClientSide(cmd.publicKey, i));
} else if (cmd.op === "decrypt") {
  const { mTotal, decryptionTimeMs } = decryptTally(cmd.privateKey, cmd.cTotal);
  out = {
    mTotal: mTotal.toString(),
    counts: decodeTally(mTotal, cmd.numCandidates),
    integrity: verifyIntegrity(mTotal, cmd.numCandidates, cmd.totalVotes),
    decryptionTimeMs,
  };
}
process.stdout.write(JSON.stringify(out));
