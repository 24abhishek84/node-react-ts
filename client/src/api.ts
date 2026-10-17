const KEY = 'taskflow.tokens';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export const tokenStore = {
  get: (): Tokens | null => JSON.parse(localStorage.getItem(KEY) ?? 'null'),
  set: (t: Tokens): void => localStorage.setItem(KEY, JSON.stringify(t)),
  clear: (): void => localStorage.removeItem(KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    body?: { error?: { message: string; code: string } }
  ) {
    super(body?.error?.message ?? `HTTP ${status}`);
    this.code = body?.error?.code;
  }

  code?: string;
}

let refreshing: Promise<Tokens> | null = null;

function refreshTokens(): Promise<Tokens> {
  refreshing ??= (async () => {
    const tokens = tokenStore.get();
    if (!tokens) throw new ApiError(401);
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) {
      tokenStore.clear();
      throw new ApiError(res.status);
    }
    const next = (await res.json()) as Tokens;
    tokenStore.set(next);
    return next;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
}

export async function api<T = unknown>(
  path: string,
  { method = 'GET', body, headers = {}, retry = true }: ApiOptions = {}
): Promise<T> {
  const tokens = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body && { 'content-type': 'application/json' }),
      ...(tokens && { authorization: `Bearer ${tokens.accessToken}` }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401 && retry && tokens) {
    await refreshTokens();
    return api<T>(path, { method, body, headers, retry: false });
  }
  if (res.status === 204) return null as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiError(res.status, json as Record<string, unknown>);
  return json as T;
}
