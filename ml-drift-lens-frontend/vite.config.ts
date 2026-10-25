import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_')

  return {
    root,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: process.env.VITE_API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'chart-vendor': ['recharts'],
          },
        },
      },
    },
  }
})
