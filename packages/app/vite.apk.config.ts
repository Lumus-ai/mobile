import base from "./vite.config"
import { defineConfig, mergeConfig } from "vite"

// APK/WebView bundle: no sourcemaps, no PWA/service-worker concerns beyond base defaults.
export default defineConfig((env) => {
  const baseConfig = typeof base === "function" ? base(env) : base
  return mergeConfig(baseConfig as any, {
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 100000,
    },
  })
})
