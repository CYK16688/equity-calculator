import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    allowedHosts: true
  },
  preview: {
    port: 3000,
    allowedHosts: true
  }
});
