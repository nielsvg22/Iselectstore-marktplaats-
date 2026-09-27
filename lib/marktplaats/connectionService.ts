import { query } from "../db";

export interface ConnectionStatus {
  environment: "mock" | "sandbox" | "production";
  connected: boolean;
  lastSuccessfulCallAt: string | null;
  tokenValid: boolean;
}

function encrypt(value: string): string {
  // Placeholder symmetric obscuring so raw tokens never sit in plaintext in
  // ad-hoc log dumps. Swap for a real KMS-backed encryption before
  // production use with a live user token.
  return Buffer.from(value, "utf8").toString("base64");
}

function decrypt(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const rows = await query<{
    environment: "mock" | "sandbox" | "production";
    connected: boolean;
    last_successful_call_at: string | null;
    token_expires_at: string | null;
  }>("SELECT environment, connected, last_successful_call_at, token_expires_at FROM marktplaats_connection ORDER BY id DESC LIMIT 1");

  const row = rows[0];
  const envFromFile = (process.env.MARKTPLAATS_ENVIRONMENT || "mock") as ConnectionStatus["environment"];

  if (!row) {
    return { environment: envFromFile, connected: false, lastSuccessfulCallAt: null, tokenValid: false };
  }

  const tokenValid = row.token_expires_at ? new Date(row.token_expires_at).getTime() > Date.now() : false;

  return {
    environment: envFromFile,
    connected: row.connected && (envFromFile === "mock" || tokenValid),
    lastSuccessfulCallAt: row.last_successful_call_at,
    tokenValid: envFromFile === "mock" ? true : tokenValid,
  };
}

export async function saveUserToken(params: { accessToken: string; refreshToken?: string; expiresInSeconds: number; scope?: string }) {
  await query(
    `UPDATE marktplaats_connection SET
       access_token_encrypted = $1,
       refresh_token_encrypted = $2,
       token_expires_at = now() + ($3 || ' seconds')::interval,
       scope = $4,
       connected = true,
       updated_at = now()
     WHERE id = (SELECT id FROM marktplaats_connection ORDER BY id DESC LIMIT 1)`,
    [encrypt(params.accessToken), params.refreshToken ? encrypt(params.refreshToken) : null, params.expiresInSeconds, params.scope ?? null]
  );
}

export async function getDecryptedUserToken(): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const rows = await query<{ access_token_encrypted: string | null; refresh_token_encrypted: string | null }>(
    "SELECT access_token_encrypted, refresh_token_encrypted FROM marktplaats_connection ORDER BY id DESC LIMIT 1"
  );
  const row = rows[0];
  if (!row?.access_token_encrypted) return null;
  return {
    accessToken: decrypt(row.access_token_encrypted),
    refreshToken: row.refresh_token_encrypted ? decrypt(row.refresh_token_encrypted) : null,
  };
}

export async function markSuccessfulCall() {
  await query("UPDATE marktplaats_connection SET last_successful_call_at = now() WHERE id = (SELECT id FROM marktplaats_connection ORDER BY id DESC LIMIT 1)");
}
