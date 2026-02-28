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

If any of the `VITE_FIREBASE_*` values are missing, the UI renders a configuration error before the router loads.

## Firebase setup checklist
1. Create a Firebase project and enable **Authentication** and **Cloud Firestore**.
2. Copy client config from Firebase Project Settings → Your apps and set all `VITE_FIREBASE_*` values.
3. Ensure your Firestore rules support the app collections (`users`, predictions data, etc.).
4. (Optional) Configure Firebase Cloud Messaging if you later want true push while the app is closed.

## Local development
Create `.env.local` next to `package.json`, then run:

```bash
npm install
npm run dev
```

## Free in-app live notifications
Notifications now run fully in the client with no Vercel cron usage:

1. User taps **Turn on** on Dashboard and grants notification permission.
2. The app checks live fixtures on the existing 2-minute polling interval.
3. When a score changes or a match reaches full-time, the browser shows a notification.

> Note: these alerts are free and require no background jobs, but they only work while the app is open in a browser tab.
