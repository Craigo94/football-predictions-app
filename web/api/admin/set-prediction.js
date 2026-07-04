import crypto from "node:crypto";

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

const getAccessToken = async (scope) => {
  const serviceAccount = getServiceAccount();
  const assertion = signJwt({
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
    tokenUri: serviceAccount.token_uri || GOOGLE_TOKEN_URL,
    scope,
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

const checkCallerAdmin = async (callerUid, accessToken, projectId) => {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${callerUid}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return {
      ok: false,
      reason: `Your user record was not found in Firebase project "${projectId}". The service account key was probably generated for a different Firebase project than the app uses — check VITE_FIREBASE_PROJECT_ID matches.`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `Could not read your user record (Firestore responded ${response.status}). The service account may be missing permissions.`,
    };
  }

  const doc = await response.json();
  // The app treats any truthy isAdmin as admin, so accept the string form of
  // the flag too (e.g. set by hand in the Firestore console).
  const isAdminField = doc.fields?.isAdmin;
  const isAdmin =
    isAdminField?.booleanValue === true || isAdminField?.stringValue === "true";
  if (!isAdmin) {
    return {
      ok: false,
      reason: `Your user record in project "${projectId}" has isAdmin = ${JSON.stringify(isAdminField ?? null)}, which is not true.`,
    };
  }

  return { ok: true };
};

const setPrediction = async (docId, prediction, accessToken, projectId) => {
  const fields = {
    userId: { stringValue: prediction.userId },
    userDisplayName: { stringValue: prediction.userDisplayName },
    fixtureId: { integerValue: String(prediction.fixtureId) },
    predHome: { integerValue: String(prediction.predHome) },
    predAway: { integerValue: String(prediction.predAway) },
    locked: { booleanValue: true },
    homeTeam: { stringValue: prediction.homeTeam },
    awayTeam: { stringValue: prediction.awayTeam },
    kickoff: { stringValue: prediction.kickoff },
    round: { stringValue: prediction.round },
    competition: { stringValue: "WORLD_CUP" },
  };

  // PATCH with an updateMask merges into (or creates) the document without
  // clobbering any other fields it may already have.
  const mask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${field}`)
    .join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/predictions/${encodeURIComponent(docId)}?${mask}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save prediction: ${response.status} ${text}`);
  }
};

const isNonNegativeInt = (value) => Number.isInteger(value) && value >= 0;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { callerUid, docId, prediction } = req.body || {};

  if (!callerUid || !docId || !prediction) {
    return res.status(400).json({ error: "Missing callerUid, docId, or prediction" });
  }

  if (typeof docId !== "string" || docId.includes("/")) {
    return res.status(400).json({ error: "Invalid docId" });
  }

  const {
    userId,
    userDisplayName,
    fixtureId,
    predHome,
    predAway,
    homeTeam,
    awayTeam,
    kickoff,
    round,
  } = prediction;

  if (
    !userId ||
    !userDisplayName ||
    !Number.isInteger(fixtureId) ||
    !isNonNegativeInt(predHome) ||
    !isNonNegativeInt(predAway) ||
    typeof homeTeam !== "string" ||
    typeof awayTeam !== "string" ||
    typeof kickoff !== "string" ||
    typeof round !== "string"
  ) {
    return res.status(400).json({ error: "Invalid prediction payload" });
  }

  try {
    const { accessToken, projectId } = await getAccessToken(
      "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase"
    );

    const adminCheck = await checkCallerAdmin(callerUid, accessToken, projectId);
    if (!adminCheck.ok) {
      return res.status(403).json({ error: adminCheck.reason });
    }

    await setPrediction(docId, prediction, accessToken, projectId);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("set-prediction error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
