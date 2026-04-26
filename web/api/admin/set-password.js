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

const isCallerAdmin = async (callerUid, accessToken, projectId) => {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${callerUid}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return false;

  const doc = await response.json();
  const isAdmin = doc.fields?.isAdmin?.booleanValue === true;
  return isAdmin;
};

const setUserPassword = async (userId, newPassword, accessToken, projectId) => {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ localId: userId, password: newPassword }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update password: ${response.status} ${text}`);
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, callerUid, newPassword } = req.body || {};

  if (!userId || !callerUid || !newPassword) {
    return res.status(400).json({ error: "Missing userId, callerUid, or newPassword" });
  }

  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const { accessToken, projectId } = await getAccessToken(
      "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase"
    );

    const adminCheck = await isCallerAdmin(callerUid, accessToken, projectId);
    if (!adminCheck) {
      return res.status(403).json({ error: "Caller is not an admin" });
    }

    await setUserPassword(userId, newPassword, accessToken, projectId);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("set-password error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
