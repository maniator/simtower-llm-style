import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: "src",
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@core": path.resolve(__dirname, "./src/core"),
      "@ui": path.resolve(__dirname, "./src/ui"),
      "@data": path.resolve(__dirname, "./src/data"),
      "@storage": path.resolve(__dirname, "./src/storage"),
      "@types": path.resolve(__dirname, "./src/types"),
      "@tests": path.resolve(__dirname, "./src/tests"),
    },
  },
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
    environment: "jsdom",
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
