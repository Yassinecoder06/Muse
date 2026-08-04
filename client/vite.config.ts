import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The application keeps its single shared .env file at the repository root.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  server: { port: 5173 },
  build: { sourcemap: true },
})
