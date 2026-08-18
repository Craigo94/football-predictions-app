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
| `VITE_FOOTBALL_SEASON` | Optional. Numeric season override (the year the season starts in, e.g. `2026` for 2026/27); defaults to the current PL season. |
| `VITE_FIREBASE_VAPID_KEY` | Firebase Web Push certificate key (VAPID public key) for browser token registration. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Full JSON of a Firebase service account key. Required by the server-side admin endpoints (`/api/admin/set-password`, `/api/admin/delete-user`, `/api/admin/set-prediction`) and push notifications. Without it those admin actions fail with "Missing FIREBASE_SERVICE_ACCOUNT_KEY". |
| `FOOTBALL_DATA_TOKEN` | football-data.org API token used by the fixtures proxy endpoints. |

If any of the `VITE_FIREBASE_*` values are missing, the UI renders a configuration error before the router loads.

### Getting the service account key
1. Firebase Console → Project settings (gear icon) → **Service accounts** tab.
2. Click **Generate new private key** — this downloads a JSON file.
3. In Vercel → Project Settings → Environment Variables, add `FIREBASE_SERVICE_ACCOUNT_KEY` with the **entire contents of that JSON file** as the value (paste it as-is; Vercel handles multi-line values).
4. Redeploy — environment variables only take effect on new deployments.

Keep this key secret: it grants full admin access to the Firebase project. Never commit it to the repository.

## Firebase setup checklist
1. Create a Firebase project and enable **Authentication** and **Cloud Firestore**.
2. Copy client config from Firebase Project Settings → Your apps and set all `VITE_FIREBASE_*` values.
3. Ensure your Firestore rules support the app collections (`users`, predictions data, etc.).
4. Enable Firebase Cloud Messaging (free tier supported) and create a Web Push certificate key.
5. Add `VITE_FIREBASE_VAPID_KEY` (public key) so browser devices can register push tokens.

## Season rollover

The app plays one Premier League season at a time, identified by the year it
starts in — `2026` means 2026/27. `getSeasonInfo()` in `src/api/football.ts`
reads the live season from football-data's own competition endpoint, so
rollover needs no change each summer. The date-based guess in
`src/config/football.ts` is only a fallback for when that call fails.

Every prediction ever made lives in the single `predictions` Firestore
collection, so nothing needs deleting between seasons. Documents are tagged with
`season` and `competition` on save, and every screen filters reads through
`isCurrentSeasonPrediction` (`src/utils/season.ts`) so last season's points,
weekly winners, and gameweek tables do not leak into the new one. Documents
written before those fields existed are matched on kick-off date instead, using a
1 July – 30 June window.

At the start of a season the leaderboard, winners history, and My Stats are
empty until the first gameweek finishes — that is expected, not a data loss.

## When no fixtures show up

Hit the health endpoint on the deployment first — it runs the same three calls
the app makes, using the server's token, and says which one broke:

```
curl -s https://<your-app>/api/football/health | jq
```

It reports the season football-data says is live, what is scheduled in the next
ten days, and whether fetching that round *by season* returns the same games.
`problems` names anything that does not line up. Common causes:

| Symptom in the response | Cause | Fix |
| --- | --- | --- |
| `tokenPresent: false` | `FOOTBALL_DATA_TOKEN` missing on this deployment | Add it in Vercel, then redeploy — env vars only apply to new deployments |
| `roundBySeason.matchesTheDateLookup: false` | The app is asking for the right matchday of the wrong season | Unset `VITE_FOOTBALL_SEASON` and redeploy |
| status `429` | Free plan allows 10 requests/minute | Wait a minute; scores return on the next poll |
| status `403` | Free plan only covers the competition's current season | Unset `VITE_FOOTBALL_SEASON` |
| `upcoming.count: 0` | Genuinely no fixtures in the next 10 days | Nothing to fix — international break |

**`VITE_FOOTBALL_SEASON` is the usual culprit.** Pinning it to a season that has
finished makes every fixture lookup ask for the right matchday of the wrong
year. Leave it unset: the app reads the live season from the competition itself
and only falls back to a date-based guess if that call fails. If it is set and
disagrees with the API, the app keeps using it (it is an explicit override) but
logs a warning naming both seasons.

## Local development
Create `.env.local` next to `package.json`, then run:

```bash
npm install
npm run dev
```

## Free notifications (no paid services required)

The app supports two free notification modes:

1. **In-app alerts (default)**
   - User taps **Turn on** and grants permission.
   - The app polls fixtures every 2 minutes and shows alerts for goals/full-time while the app is open.

2. **Background push (recommended for home-screen installs)**
   - Add `VITE_FIREBASE_VAPID_KEY` and keep Firebase Cloud Messaging enabled.
   - User token is saved to Firestore in `users.notificationTokens`.
   - Call `/api/notifications/send-live-updates` from a free scheduler (for example GitHub Actions cron) to trigger FCM pushes when scores change.

This keeps everything on free tiers (Firebase + your existing serverless endpoint) and works when the app is closed.
