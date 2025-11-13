// web/vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (!env.VITE_FOOTBALL_DATA_TOKEN) {
    console.warn(
      "[Vite proxy] VITE_FOOTBALL_DATA_TOKEN is empty. " +
      "Requests to /api/football will likely return 401 in dev " +
      "until you set it in .env.local and restart the dev server."
    );
  }

  return {
    // Vercel serves from the domain root, not /football-predictions-app/
    base: "/",

    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "/64px-Soccer_ball.png",
          "/128px-Soccer_ball.png",
          "/256px-Soccer_ball.png"
        ],
        manifest: {
          name: "Family Premier League Picks",
          short_name: "Footy Picks",
          description:
            "Family Premier League score predictions with live points and leaderboards.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#020817",
          theme_color: "#020817",
          icons: [
            {
              src: "/64px-Soccer_ball.png",
              sizes: "64x64",
              type: "image/png"
            },
            {
              src: "/128px-Soccer_ball.png",
              sizes: "128x128",
              type: "image/png"
            },
            {
              src: "/256px-Soccer_ball.png",
              sizes: "256x256",
              type: "image/png"
            }
          ]
        },
        workbox: {
          navigateFallback: "/index.html",
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"]
        }
      })

    ],

    // Dev server (local only)
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api/football": {
          target: "https://api.football-data.org/v4",
          changeOrigin: true,
          secure: true,
          headers: {
            "X-Auth-Token": env.VITE_FOOTBALL_DATA_TOKEN || "",
          },
          // /api/football/competitions/PL/matches -> /competitions/PL/matches
          rewrite: (path) => path.replace(/^\/api\/football/, ""),
        },
      },
    },

    preview: {
      host: "0.0.0.0",
      port: 4173,
    },
  };
});
