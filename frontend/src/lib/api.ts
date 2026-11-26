/**
 * Thin client for the Digital Heroes API. Adds the bearer token, parses
 * JSON, and turns error responses into ApiError with the server's message.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

const TOKEN_KEY = "dh_token";

export function getToken(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — session lasts for this page only */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { fields?: Record<string, string>; issues?: { elementId: string | null; message: string }[]; errors?: string[] },
  ) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

async function request(path: string, opts: Options = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method: opts.method || (body ? "POST" : "GET"), headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let details: ApiError["details"];
    try {
      const data = await res.json();
      message = data.error || message;
      details = data.details;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event("dh:logout"));
    }
    throw new ApiError(res.status, message, details);
  }
  return res;
}

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const res = await request(path, opts);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiBlob(path: string, opts: Options = {}): Promise<{ blob: Blob; headers: Headers }> {
  const res = await request(path, opts);
  return { blob: await res.blob(), headers: res.headers };
}

/** Downloads an authenticated file and saves it with the server's filename. */
export async function downloadFile(path: string, fallbackName = "download") {
  const { blob, headers } = await apiBlob(path);
  const cd = headers.get("content-disposition") || "";
  const name = cd.match(/filename="?([^";]+)"?/)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Opens an authenticated file (e.g. a PDF proof) in a new tab. */
export async function openFile(path: string) {
  const win = window.open("", "_blank");
  try {
    const { blob } = await apiBlob(path);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

export function upload(kind: "logo" | "artwork" | "csv", file: File) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file);
  return api("/assets", { form });
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");
