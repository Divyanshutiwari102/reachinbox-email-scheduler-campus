let cachedToken: string | null = null;

async function getRawToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  const res = await fetch('/api/token');
  if (!res.ok) return null;
  const data = await res.json();
  cachedToken = data.token;
  return cachedToken;
}

const apiFetch = async (input: RequestInfo, init?: RequestInit) => {
  const token = await getRawToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res = await fetch(input, { ...init, headers });
  if (res.status === 401 && cachedToken) {
    cachedToken = null;
    const retryToken = await getRawToken();
    const retryHeaders = new Headers(init?.headers);
    if (retryToken) retryHeaders.set('Authorization', `Bearer ${retryToken}`);
    res = await fetch(input, { ...init, headers: retryHeaders });
  }
  return res;
};

export default apiFetch;