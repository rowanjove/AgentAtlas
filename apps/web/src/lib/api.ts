let csrfToken: string | null = null;
let sessionPromise: Promise<string> | null = null;

export async function ensureSessionToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!sessionPromise) {
    sessionPromise = fetch('/api/session', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to initialize local session');
        const data = (await res.json()) as { csrfToken: string };
        csrfToken = data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        sessionPromise = null;
      });
  }
  return sessionPromise;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function apiMutate<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const execute = async (forceRefreshToken: boolean): Promise<Response> => {
    if (forceRefreshToken) {
      csrfToken = null;
    }
    const token = await ensureSessionToken();
    const headers: Record<string, string> = {
      'X-Atlas-Token': token,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await execute(false);
  if (res.status === 403) {
    const cloned = await res.clone().json().catch(() => null) as { error?: string } | null;
    if (cloned?.error?.includes('X-Atlas-Token')) {
      res = await execute(true);
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
