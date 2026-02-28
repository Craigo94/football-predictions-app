import crypto from "node:crypto";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4/competitions/PL/matches";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const base64UrlEncode = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const signJwt = ({ clientEmail, privateKey, tokenUri, scope }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })
  );

  const unsigned = `${header}.${claim}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsigned}.${signature}`;
};

const getServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_KEY.");
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is missing required fields.");
  }
  return parsed;
};

const getGoogleAccessToken = async () => {
  const serviceAccount = getServiceAccount();
  const assertion = signJwt({
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
    tokenUri: serviceAccount.token_uri || GOOGLE_TOKEN_URL,
    scope: [
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/firebase.messaging",
    ].join(" "),
  });

  const response = await fetch(serviceAccount.token_uri || GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed (${response.status}).`);
  }

  const json = await response.json();
  return { accessToken: json.access_token, projectId: serviceAccount.project_id };
};

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const fetchRelevantFixtures = async () => {
  const token = process.env.FOOTBALL_DATA_TOKEN || process.env.VITE_FOOTBALL_DATA_TOKEN;
  if (!token) throw new Error("Missing FOOTBALL_DATA_TOKEN.");

  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 2);
  const to = new Date(now);
  to.setDate(now.getDate() + 1);

  const url = new URL(FOOTBALL_DATA_BASE);
  url.searchParams.set("dateFrom", toIsoDate(from));
  url.searchParams.set("dateTo", toIsoDate(to));
  url.searchParams.set("status", "IN_PLAY,PAUSED,FINISHED");

  const res = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (!res.ok) throw new Error(`Football data request failed (${res.status}).`);
  const data = await res.json();
  return Array.isArray(data.matches) ? data.matches : [];
};

const normalizeFixture = (raw) => ({
  id: raw.id,
  status: raw.status,
  homeTeam: raw.homeTeam?.name || "Home",
  awayTeam: raw.awayTeam?.name || "Away",
  homeGoals: raw.score?.fullTime?.home,
  awayGoals: raw.score?.fullTime?.away,
});

const formatScoreLine = (fixture) => {
  const homeGoals = fixture.homeGoals ?? "-";
  const awayGoals = fixture.awayGoals ?? "-";
  return `${fixture.homeTeam} ${homeGoals} - ${awayGoals} ${fixture.awayTeam}`;
};

const isAuthValid = (request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer === secret || request.headers["x-cron-secret"] === secret;
};

const firestoreBase = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const firestoreRequest = async (projectId, accessToken, path, init = {}) => {
  const res = await fetch(`${firestoreBase(projectId)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
};

const parseStringArrayField = (fields, key) => {
  const values = fields?.[key]?.arrayValue?.values;
  if (!Array.isArray(values)) return [];
  return values.map((value) => value.stringValue).filter(Boolean);
};

const loadNotificationTokens = async (projectId, accessToken) => {
  const res = await firestoreRequest(projectId, accessToken, "/users?pageSize=1000");
  if (!res.ok) throw new Error("Failed to read users from Firestore.");

  const json = await res.json();
  const docs = Array.isArray(json.documents) ? json.documents : [];
  const tokens = new Set();

  docs.forEach((doc) => {
    parseStringArrayField(doc.fields, "notificationTokens").forEach((token) =>
      tokens.add(token)
    );
  });

  return Array.from(tokens);
};

const loadFixtureState = async (projectId, accessToken, fixtureId) => {
  const res = await firestoreRequest(
    projectId,
    accessToken,
    `/fixtureStates/${fixtureId}`
  );

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed loading state for fixture ${fixtureId}.`);

  const json = await res.json();
  const fields = json.fields || {};
  return {
    status: fields.status?.stringValue || null,
    homeGoals:
      fields.homeGoals?.integerValue != null
        ? Number(fields.homeGoals.integerValue)
        : null,
    awayGoals:
      fields.awayGoals?.integerValue != null
        ? Number(fields.awayGoals.integerValue)
        : null,
  };
};

const saveFixtureState = async (projectId, accessToken, fixture) => {
  await firestoreRequest(projectId, accessToken, `/fixtureStates/${fixture.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        status: { stringValue: fixture.status || "" },
        homeGoals:
          fixture.homeGoals == null
            ? { nullValue: null }
            : { integerValue: String(fixture.homeGoals) },
        awayGoals:
          fixture.awayGoals == null
            ? { nullValue: null }
            : { integerValue: String(fixture.awayGoals) },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
};

const changedEvents = (previous, next) => {
  if (!previous) return [];

  const events = [];
  const scoreChanged =
    next.homeGoals != null &&
    next.awayGoals != null &&
    (next.homeGoals !== previous.homeGoals || next.awayGoals !== previous.awayGoals);
  if (scoreChanged) {
    const scoreLine = formatScoreLine(next);
    const homeIncreased =
      previous.homeGoals != null && next.homeGoals > previous.homeGoals;
    const awayIncreased =
      previous.awayGoals != null && next.awayGoals > previous.awayGoals;
    const scorer = homeIncreased
      ? next.homeTeam
      : awayIncreased
        ? next.awayTeam
        : "Goal update";

    events.push({
      title: `${scorer} scores!`,
      body: scoreLine,
      tag: `score-${next.id}-${next.homeGoals}-${next.awayGoals}`,
      url: `/dashboard?fixture=${next.id}`,
    });
  }

  const switchedToFt = previous.status !== "FINISHED" && next.status === "FINISHED";
  if (switchedToFt) {
    const scoreLine = formatScoreLine(next);
    events.push({
      title: "Full-time",
      body: scoreLine,
      tag: `fulltime-${next.id}`,
      url: `/dashboard?fixture=${next.id}`,
    });
  }

  return events;
};

const sendFcmNotification = async ({ projectId, accessToken, token, event }) => {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: event.title,
            body: event.body,
          },
          webpush: {
            headers: {
              Urgency: "high",
              TTL: "300",
            },
            fcm_options: {
              link: event.url || "/dashboard",
            },
            notification: {
              icon: "/128px-Soccer_ball.png",
              badge: "/64px-Soccer_ball.png",
              tag: event.tag,
              renotify: true,
            },
          },
          data: {
            tag: event.tag,
            link: event.url || "/dashboard",
          },
        },
      }),
    }
  );

  return res.ok;
};

export default async function handler(request, response) {
  try {
    if (request.method !== "POST" && request.method !== "GET") {
      return response.status(405).json({ error: "Method not allowed" });
    }

    if (!isAuthValid(request)) {
      return response.status(401).json({ error: "Unauthorized" });
    }

    const { accessToken, projectId } = await getGoogleAccessToken();
    const fixtures = (await fetchRelevantFixtures()).map(normalizeFixture);
    const tokens = await loadNotificationTokens(projectId, accessToken);

    let eventsTriggered = 0;
    let notificationsSent = 0;

    for (const fixture of fixtures) {
      const previous = await loadFixtureState(projectId, accessToken, fixture.id);
      const events = changedEvents(previous, fixture);
      eventsTriggered += events.length;

      for (const event of events) {
        await Promise.all(
          tokens.map(async (token) => {
            const sent = await sendFcmNotification({
              projectId,
              accessToken,
              token,
              event,
            });
            if (sent) notificationsSent += 1;
          })
        );
      }

      await saveFixtureState(projectId, accessToken, fixture);
    }

    return response.status(200).json({
      ok: true,
      fixturesChecked: fixtures.length,
      subscriptions: tokens.length,
      eventsTriggered,
      notificationsSent,
    });
  } catch (error) {
    console.error("send-live-updates failed", error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
