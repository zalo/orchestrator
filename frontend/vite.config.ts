import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    },
    allowedHosts: ['orchestrator.sels.tech']
  },
  build: {
    // Generate source maps for production debugging
    sourcemap: true,
    // Use content hashes in filenames for cache busting
    rollupOptions: {
      output: {
        // JS chunks: [name].[contenthash].js
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        // CSS and other assets: [name].[contenthash].[ext]
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  }
})
