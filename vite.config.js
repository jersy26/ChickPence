import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Cross-origin isolation lets the ONNX runtime use several CPU threads for
// Whisper (voice typing); without it, it runs on one. "credentialless" still
// allows Google Fonts, Supabase and Ollama. The server hosting the built app
// must send the same two headers.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless'
};

export default defineConfig({
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.svg', 'pwa-512x512.svg'],
      manifest: {
        name: 'ChickPence: Poultry Cost & Profitability',
        short_name: 'ChickPence',
        description: 'Batch-Centric Relational Database System for Poultry Cost and Profitability Analysis',
        theme_color: '#f7f7f4',
        background_color: '#f4f3ef',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // mjs: the pdf.js worker (PDF import) and the ONNX runtime loader (voice) work offline too
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-shell'
            }
          }
        ]
      }
    })
  ],
  // The Whisper worker (voice typing) imports Transformers.js as an ES module
  worker: {
    format: 'es'
  },
  server: {
    port: 3000,
    headers: ISOLATION_HEADERS
  },
  preview: {
    headers: ISOLATION_HEADERS
  }
});
