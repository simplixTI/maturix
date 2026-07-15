import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend API runs on :3000. The dev server runs on :3001 and proxies
// backend paths (/api, /health, /socket.io) to the backend.
//
// IMPORTANT: target uses 127.0.0.1 (IPv4) — NOT "localhost". On Windows,
// "localhost" resolves to IPv6 (::1) first, and if another app (e.g. a Next.js
// project) is squatting on :3000 over IPv6, "localhost" would hit that app and
// return 404 for our routes. Pinning to 127.0.0.1 always reaches our backend.
const API_TARGET = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});
