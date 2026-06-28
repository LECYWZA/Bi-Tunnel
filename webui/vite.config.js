import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: '../src/web/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:8888',
        changeOrigin: true,
        secure: false, // Ignore self-signed certs
      }
    }
  }
})
