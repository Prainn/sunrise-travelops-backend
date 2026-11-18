import { isIP } from 'node:net';

export function visitsApiOrigin(value: string | undefined): URL {
  const url = new URL(value ?? '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('LYNX_VISITS_API_URL must be an HTTPS origin');
  return url;
}

export function visitsApiToken(value: string | undefined): boolean {
  return !!value && /^[\x21-\x7e]{32,512}$/.test(value);
}

export function normalizeVisitIp(value: string): string {
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

export function visitsApiIps(value: string | undefined): string[] {
  const ips = (value ?? '').split(',').map((ip) => normalizeVisitIp(ip.trim()));
  if (!ips.length || ips.some((ip) => !isIP(ip)))
    throw new Error(
      'LYNX_VISITS_API_ALLOWED_IPS must contain explicit IP addresses',
    );
  return ips;
}

export function validateVisitsEnvironment(
  env: Record<string, string | undefined>,
) {
  const mode = env.LYNX_VISITS_SOURCE_MODE ?? 'database';
  if (!['database', 'http'].includes(mode))
    throw new Error('Invalid LYNX_VISITS_SOURCE_MODE');
  if (
    env.LYNX_VISITS_API_ENABLED &&
    !['true', 'false'].includes(env.LYNX_VISITS_API_ENABLED)
  )
    throw new Error('LYNX_VISITS_API_ENABLED must be true or false');
  const enabled = env.LYNX_VISITS_API_ENABLED === 'true';
  if (enabled) {
    if (mode !== 'database')
      throw new Error('The visits server API requires a database source');
    if (!visitsApiToken(env.LYNX_VISITS_API_SERVER_TOKEN))
      throw new Error('Invalid visits server token');
    visitsApiIps(env.LYNX_VISITS_API_ALLOWED_IPS);
  }
  if (mode === 'http') {
    visitsApiOrigin(env.LYNX_VISITS_API_URL);
    if (!visitsApiToken(env.LYNX_VISITS_API_CLIENT_TOKEN))
      throw new Error('Invalid visits client token');
    if (env.LYNX_VISITS_API_CONNECT_IP && !isIP(env.LYNX_VISITS_API_CONNECT_IP))
      throw new Error('LYNX_VISITS_API_CONNECT_IP must be an IP address');
  }
  for (const token of [
    env.LYNX_VISITS_API_CLIENT_TOKEN,
    env.LYNX_VISITS_API_SERVER_TOKEN,
  ]) {
    if (
      token &&
      [
        env.JWT_SECRET,
        env.REFRESH_TOKEN_SECRET,
        env.WHATSAPP_RESOLVER_TOKEN,
        env.WHATSAPP_CHAT_HTTP_TOKEN,
      ].includes(token)
    )
      throw new Error(
        'Visits API tokens must be separate from existing application tokens',
      );
  }
}
