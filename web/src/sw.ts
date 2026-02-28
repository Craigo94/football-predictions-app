/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    url?: string;
    tag?: string;
  } = {};

  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title || "Live score update";
  const options: NotificationOptions = {
    body: payload.body || "A Premier League score just changed.",
    icon: payload.icon || "/128px-Soccer_ball.png",
    badge: payload.badge || "/64px-Soccer_ball.png",
    tag: payload.tag || "live-score",
    data: {
      url: payload.url || "/dashboard",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination =
    typeof event.notification.data?.url === "string"
      ? event.notification.data.url
      : "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const windowClient = client as WindowClient;
        if (windowClient.url.includes(self.location.origin) && "focus" in windowClient) {
          windowClient.navigate(destination);
          return windowClient.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(destination);
      }
      return Promise.resolve(undefined);
    })
  );
});
