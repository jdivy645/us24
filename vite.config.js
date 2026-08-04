import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // transformers.js ships its own wasm/worker assets — prebundling breaks them
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
