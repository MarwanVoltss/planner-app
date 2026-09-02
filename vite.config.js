import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { target: 'es2020' },
  // Bind to *all* interfaces so "localhost" resolves with IPv4 (127.0.0.1).
  // Without this, vite preview/dev only listens on IPv6 (::1), and Chrome on
  // Windows resolves localhost to IPv4 first -> blank page / connection refused.
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
});