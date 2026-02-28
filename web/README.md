# Football Predictions Web App

This Vite/React app uses Firebase Authentication and Firestore for user accounts, payments tracking, and admin tooling. The site will not start unless all Firebase environment variables are present, so deployments need the full client config.

## Required environment variables
Add these variables in Vercel (Project Settings → Environment Variables) for the **Production**, **Preview**, and **Development** environments. Variables prefixed with `VITE_` are read at build-time by Vite.

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_PRIMARY_ADMIN_EMAIL` | Optional. Email allowed to view the admin dashboard; other users are redirected. |
| `VITE_FOOTBALL_SEASON` | Optional. Numeric season override; defaults to current PL season. |
| `VITE_WEB_PUSH_PUBLIC_KEY` | Firebase Web Push certificate key (VAPID public key) for browser token registration. |
| `FOOTBALL_DATA_TOKEN` | Football-Data token used by the server cron sender. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Stringified Firebase service account JSON (used by the notification cron API). |
| `CRON_SECRET` | Optional shared secret for `/api/notifications/send-live-updates`. |

If any of the `VITE_FIREBASE_*` values are missing, the UI renders a configuration error before the router loads.

## Firebase setup checklist
1. Create a Firebase project and enable **Authentication** and **Cloud Firestore**.
2. Copy client config from Firebase Project Settings → Your apps and set all `VITE_FIREBASE_*` values.
3. Ensure your Firestore rules support the app collections (`users`, predictions data, etc.).
4. Add a service account JSON as `FIREBASE_SERVICE_ACCOUNT_KEY` in Vercel for cron sender access.

## Local development
Create `.env.local` next to `package.json`, then run:

```bash
npm install
npm run dev
```

## Closed-app score notifications (true push)
This repo now supports push notifications that can arrive when the app is closed:

1. User taps **Turn on** on Dashboard and grants notification permission.
2. Client requests an FCM web token (using `VITE_WEB_PUSH_PUBLIC_KEY`) and stores it in `users.notificationTokens`.
3. Vercel cron calls `/api/notifications/send-live-updates` every 2 minutes.
4. Cron compares recent fixture state in Firestore (`fixtureStates`) and sends FCM notifications on score/full-time changes.
5. Browser/OS displays the push notification via the service worker.

### iOS caveats
- iOS/iPadOS support requires **16.4+** and launching from Home Screen.
- Focus mode / OS settings can block delivery.
- Delivery is best-effort; exact-second delivery is not guaranteed.
