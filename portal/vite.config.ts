import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// The portal is a separate app from the public website (its own origin in production: admin.alazharpark.com).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
