import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src",
  base: "./",
  server: {
    port: 5173,
    open: false,
    host: true,
  },
  build: {
    target: "esnext",
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        gallery: resolve(__dirname, "src/gallery.html"),
        preview: resolve(__dirname, "src/preview.html"),
        excalibur: resolve(__dirname, "src/excalibur.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    root: ".",
    include: ["src/**/*.test.ts"],
    // A few end-to-end tests drive many in-game days of the full hourly v2
    // simulation over a tall tower; they pass quickly locally but can exceed the
    // 5s default on slower CI runners. Give the suite generous headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/engine/**/*.ts", "src/storage/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.config.*", "**/types.ts"],
    },
  },
});
