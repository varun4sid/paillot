import os from "node:os";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PORT = Number(process.env.PORT) || 5180;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5179";

/** First non-internal IPv4 address (prefers Wi-Fi en0), so the QR code works from phones. */
function lanIp() {
  const ifaces = os.networkInterfaces();
  const names = ["en0", ...Object.keys(ifaces).filter((n) => n !== "en0")];
  for (const name of names) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __LAN_ORIGIN__: JSON.stringify(`http://${lanIp()}:${PORT}`),
  },
  server: {
    host: true,
    port: PORT,
    strictPort: true,
    proxy: { "/api": BACKEND_URL },
  },
});
