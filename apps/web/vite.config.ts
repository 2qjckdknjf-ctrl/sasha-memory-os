import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget =
  process.env.MEMORY_OS_WEB_API_PROXY_TARGET ?? 'http://localhost:8787';
const apiProxySecret = process.env.MEMORY_OS_WEB_API_PROXY_SECRET?.trim();
const apiProxy = {
  target: apiProxyTarget,
  ...(apiProxySecret
    ? { headers: { 'x-memory-os-api-secret': apiProxySecret } }
    : {}),
};

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    port: 5173,
    proxy: {
      '/v1': apiProxy,
      '/health': apiProxy,
    },
  },
});

