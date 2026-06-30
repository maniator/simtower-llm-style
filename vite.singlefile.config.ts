import { defineConfig } from "vite";
import { resolve } from "node:path";
import { viteSingleFile } from "vite-plugin-singlefile";

// A one-file build of the game (everything inlined) for easy sharing/testing.
export default defineConfig({
  root: "src",
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: "esnext",
    outDir: "../dist-single",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 100000000,
    rollupOptions: { input: resolve(__dirname, "src/index.html") },
  },
});
