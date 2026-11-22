import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000", // change if your backend uses another port
        changeOrigin: true,
      },
    },
  },
});
