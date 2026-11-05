import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 1420 is the Tauri 2 convention; strictPort keeps devUrl in tauri.conf.json honest.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
