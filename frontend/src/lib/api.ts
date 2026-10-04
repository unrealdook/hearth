const SESSION_KEY = "hearth.session";

export function getToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(SESSION_KEY, t);
  else localStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(status: number, payload: any) {
    super(payload?.message || payload?.error || `HTTP ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

async function request<T = any>(method: string, path: string, body?: any, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers["X-Hearth-Session"] = token;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    if (res.status === 401) handle401();
    throw new ApiError(res.status, payload);
  }
  return payload as T;
}

function handle401() {
  setToken(null);
  // tell the auth provider to flip to the lock screen
  window.dispatchEvent(new CustomEvent("hearth-auth-expired"));
}

export async function uploadFile<T = any>(path: string, file: File, fieldName = "file"): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["X-Hearth-Session"] = token;
  const fd = new FormData();
  fd.append(fieldName, file);
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: fd });
  const text = await res.text();
  let payload: any = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
  if (!res.ok) {
    if (res.status === 401) handle401();
    throw new ApiError(res.status, payload);
  }
  return payload as T;
}

/** POST a JSON body and download the binary response (e.g. a generated PDF). */
export async function downloadPost(path: string, body: any, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["X-Hearth-Session"] = token;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let payload: any = null;
    const t = await res.text();
    if (t) { try { payload = JSON.parse(t); } catch { payload = t; } }
    if (res.status === 401) handle401();
    throw new ApiError(res.status, payload);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="?([^"]+)"?/);
  const name = m ? m[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function photoUrl(path: string): string {
  // For <img src=...>. Append session token as a query param so the browser
  // GET (which doesn't honor our X-Hearth-Session header on <img>) still auths.
  // Backend reads it from either header or query.
  const token = getToken() ?? "";
  const sep = path.includes("?") ? "&" : "?";
  return `/api${path}${sep}t=${encodeURIComponent(token)}`;
}

export const api = {
  get:    <T = any>(path: string) => request<T>("GET", path),
  post:   <T = any>(path: string, body?: any) => request<T>("POST", path, body),
  put:    <T = any>(path: string, body?: any) => request<T>("PUT", path, body),
  del:    <T = any>(path: string) => request<T>("DELETE", path),
  upload: uploadFile,
  downloadPost,
};
