# Football Predictions Web App

This Vite/React app uses Firebase Authentication and Firestore for user accounts, payments tracking, and admin tooling. The site will not start unless all Firebase environment variables are present, so deployments need the full client config.

## Required environment variables
Add these variables in Vercel (Project Settings → Environment Variables) for the **Production**, **Preview**, and **Development** environments. They are read at build-time by Vite, so redeploy after changes.

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_PRIMARY_ADMIN_EMAIL` | Optional. Email allowed to view the admin dashboard; other users will be redirected. |
| `VITE_FOOTBALL_SEASON` | Optional. Numeric season override; defaults to the current Premier League season. |

If any of the `VITE_FIREBASE_*` values are missing, the UI will render a configuration error before the router loads. This is the same as not having the variables set in Vercel.

## Firebase setup checklist
1. Create a Firebase project and enable **Authentication** (Email/Password or your chosen provider) and **Cloud Firestore**.
2. Copy the client configuration from Project Settings → General → Your apps and paste the values into the `VITE_FIREBASE_*` variables above.
3. Deploy the Firestore security rules that match your app. (The app assumes a `users` collection with `isAdmin` and `hasPaid` fields.)
4. If you want to lock admin access, set `VITE_PRIMARY_ADMIN_EMAIL` to the email address that should always be the admin. Leave it empty to allow assigning any user as admin.

## Local development
Create a `.env.local` next to `package.json` with the same variables, then install dependencies and start Vite:

```bash
npm install
npm run dev
```
