import icon from "astro-icon";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://cookiesfilmfest.com",
  integrations: [icon()],
  vite: {
    build: {
      chunkSizeWarningLimit: 600,
    },
  },
});
