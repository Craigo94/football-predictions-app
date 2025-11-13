// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repoBase = "/football-predictions-app/"; 

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (!env.VITE_FOOTBALL_DATA_TOKEN) {
    console.warn(
      "[Vite proxy] VITE_FOOTBALL_DATA_TOKEN is empty. " +
        "Requests to /football-api will likely return 401 until you set it in .env.local and restart the dev server."
    );
  }

  return {
    base: repoBase, // <-- THIS is what GitHub Pages needs

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
          // important for PWA on GitHub Pages:
          start_url: repoBase,
          scope: repoBase,
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

    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/football-api": {
          target: "https://api.football-data.org",
          changeOrigin: true,
          secure: true,
          headers: {
            "X-Auth-Token": env.VITE_FOOTBALL_DATA_TOKEN || "",
          },
          rewrite: (path) =>
            path
              .replace(/^\/football-api\/pl-next-fixtures/, "/v4/competitions/PL/matches")
              .replace(/^\/football-api\/pl-matches/, "/v4/competitions/PL/matches")
              .replace(/^\/football-api/, ""),
        },
      },
    },

    preview: {
      host: "0.0.0.0",
      port: 4173,
    },
  };
});
