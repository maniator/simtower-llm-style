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
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/engine/**/*.ts", "src/storage/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.config.*", "**/types.ts"],
    },
  },
});
