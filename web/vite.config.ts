// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  // Load env (reads .env.local, .env, etc.). Only VITE_* are exposed.
  const env = loadEnv(mode, process.cwd(), "");

  // Helpful warning if the token isn't loaded (remember to restart `npm run dev` after editing .env.local)
  if (!env.VITE_FOOTBALL_DATA_TOKEN) {
    console.warn(
      "[Vite proxy] VITE_FOOTBALL_DATA_TOKEN is empty. " +
        "Requests to /football-api will likely return 401 until you set it in .env.local and restart the dev server."
    );
  }

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["/icons/icon-192.png", "/icons/icon-512.png"],
        manifest: {
          name: "Family Premier League Picks",
          short_name: "Footy Picks",
          description:
            "Family Premier League score predictions with live points and leaderboards.",
          start_url: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#020817",
          theme_color: "#020817",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/maskable-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          navigateFallback: "/index.html",
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        },
      }),
    ],

    // Dev server reachable from your phone (hotspot / same Wi-Fi)
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/football-api": {
          target: "https://api.football-data.org",
          changeOrigin: true,
          secure: true,
          // Inject the token on the server-side so the browser (phone) never sees it
          headers: {
            "X-Auth-Token": env.VITE_FOOTBALL_DATA_TOKEN || "",
          },
          // Map friendly routes to real v4 endpoints, then strip the prefix for all other calls
          rewrite: (path) =>
            path
              .replace(/^\/football-api\/pl-next-fixtures/, "/v4/competitions/PL/matches")
              .replace(/^\/football-api\/pl-matches/, "/v4/competitions/PL/matches")
              .replace(/^\/football-api/, ""),
        },
      },
    },

    // Preview server for `npm run preview` (also reachable on LAN)
    preview: {
      host: "0.0.0.0",
      port: 4173,
    },
  };
});
