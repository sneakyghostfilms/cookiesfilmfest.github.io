import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { propsDemo } from "./scripts/props/demo-server.mjs";

// https://astro.build/config
export default defineConfig({
  site: "https://cookiesfilmfest.com",
  integrations: [icon(), propsDemo(fileURLToPath(new URL("./.props-demo/", import.meta.url)))],
  vite: {
    plugins: [tailwindcss()],
    build: {
      chunkSizeWarningLimit: 600,
    },
  },
});
