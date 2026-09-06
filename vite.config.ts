import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react(), { name:'freecut-dev-csp', transformIndexHtml(html,context){return context.server?html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"):html;} }], base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true } });
