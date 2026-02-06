import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  publicDir: "public",
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: "esnext",
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/types.ts",
        "vite-env.d.ts",
      ],
    },
  },
});
