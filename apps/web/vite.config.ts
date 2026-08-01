import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * This file is Node code, but `apps/web`'s tsconfig is a DOM project and deliberately carries no
 * Node types — the engine's isolation from the platform is enforced the same way (docs/02 4.1).
 * Declaring the one thing needed here is smaller than pulling `@types/node` into the web app for a
 * single environment read.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> }

export default defineConfig({
  /*
   * GitHub Pages serves a project site from `/<repo>/`, not from the domain root, so every asset URL
   * needs that prefix or the deployed page 404s on all of it while working perfectly in dev.
   *
   * Taken from the environment rather than hard-coded so `npm run dev` and `npm run preview` stay at
   * `/`, and so a different host (docs/16 argues for Cloudflare Pages, which serves from the root)
   * needs no code change — only a different value.
   */
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing the engine package's source from the monorepo root.
    fs: { allow: ['../..'] },
  },
})
