import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing the engine package's source from the monorepo root.
    fs: { allow: ['../..'] },
  },
})
