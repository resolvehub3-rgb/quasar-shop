export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // non-browser clients
  return allowed.includes(origin);
}

export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Vary': 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'false';
  }
  headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type,X-Bridge-Token,X-Admin-Token,X-Request-Id';
  headers['Access-Control-Max-Age'] = '600';
  // Private Network Access
  headers['Access-Control-Allow-Private-Network'] = 'true';
  return headers;
}