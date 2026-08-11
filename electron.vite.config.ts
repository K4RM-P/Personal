import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {
    // electron-vite only auto-discovers src/preload/index.ts; the customer-facing
    // window has its own minimal preload, so both entries are listed explicitly.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'customer-display': resolve('src/preload/customer-display.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'customer-display': resolve('src/renderer/customer-display.html')
        }
      }
    }
  }
})
