import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { wireguardProxy } from './server/vite-proxy.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wireguardProxy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
