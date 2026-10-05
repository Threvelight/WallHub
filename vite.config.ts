import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // No offline cache: the list needs Supabase anyway, and a stale cached copy
      // left some phones on a blank screen. This ships a service worker that
      // removes any earlier one and its caches. The manifest still lets people
      // add WallHub to their home screen.
      selfDestroying: true,
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon-48.png', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'WallHub',
        short_name: 'WallHub',
        description: 'Shared household grocery list and recipes',
        theme_color: '#2f6f4f',
        background_color: '#f6f5f1',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Never cache Supabase API calls; the list must always be live.
        runtimeCaching: [],
      },
    }),
  ],
})
