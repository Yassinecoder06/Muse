import { URL } from 'url';
import dns from 'dns/promises';
import net from 'net';

const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^0\./,
];

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_IPV4_RANGES.some((r) => r.test(ip));
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    return norm === '::1' || norm.startsWith('fc') || norm.startsWith('fd') || norm.startsWith('fe80:') || norm.startsWith('::ffff:127.');
  }
  return true;
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    ['qdrant', 'ollama', 'ollama-bridge', 'supabase', 'kong', 'postgres'].includes(host)
  ) {
    throw new Error('Internal host access blocked (SSRF protection).');
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateIP(r.address))) {
    throw new Error('DNS resolved to private IP (SSRF protection).');
  }
  return parsed;
}
