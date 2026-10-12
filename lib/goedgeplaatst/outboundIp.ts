// Determines this server's outbound IP address so the admin can confirm it
// matches what was given to GoedGeplaatst for IP whitelisting. We do NOT
// hardcode the assumed VPS IP (85.190.105.138) as fact — that is only a
// likely value, per the assignment — instead we ask a simple, reliable
// "what is my IP" echo endpoint at request time, with a clear fallback
// message when that fails (no network access, egress blocked, etc).

const IP_ECHO_URL = "https://api.ipify.org?format=json";
const TIMEOUT_MS = 5_000;

export interface OutboundIpResult {
  ip: string | null;
  source: "live-check" | "unavailable";
  message?: string;
}

export async function getOutboundIp(): Promise<OutboundIpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(IP_ECHO_URL, { signal: controller.signal });
    if (!res.ok) {
      return { ip: null, source: "unavailable", message: `IP-echo-dienst gaf HTTP ${res.status} terug.` };
    }
    const data = (await res.json()) as { ip?: string };
    if (!data.ip) {
      return { ip: null, source: "unavailable", message: "IP-echo-dienst gaf geen IP-adres terug." };
    }
    return { ip: data.ip, source: "live-check" };
  } catch (err) {
    return {
      ip: null,
      source: "unavailable",
      message: `Kon uitgaand IP-adres niet bepalen (${err instanceof Error ? err.message : String(err)}). Controleer dit handmatig op de server zelf, bijvoorbeeld met "curl https://api.ipify.org".`,
    };
  } finally {
    clearTimeout(timer);
  }
}
