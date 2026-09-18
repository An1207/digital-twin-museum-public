import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({ 
  plugins: [react()], 
  server: {
    host: '127.0.0.1',
    port: 3000,
    open: false,
    watch: {
      usePolling: true,
      interval: 100,
    },
    allowedHosts: [],
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/assets': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/images': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  }, 
  build: { 
    rollupOptions: {
      external: ['three'],
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (
            id.includes('@react-three/drei') ||
            id.includes('three-stdlib') ||
            id.includes('troika-three-text') ||
            id.includes('troika-three-utils') ||
            id.includes('three-mesh-bvh') ||
            id.includes('@monogrid/gainmap-js') ||
            id.includes('draco') ||
            id.includes('meshopt')
          ) {
            return 'drei-vendor'
          }

          if (id.includes('@react-three/fiber')) {
            return 'r3f-vendor'
          }

          if (id.includes('framer-motion')) {
            return 'motion-vendor'
          }

          return undefined
        },
      },
    },
  },
}) 
