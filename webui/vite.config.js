import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: '../src/web/public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return
        warn(warning)
      }
    },
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return
        warn(warning)
      }
    }
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
