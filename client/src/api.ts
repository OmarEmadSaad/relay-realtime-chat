import type { ApiResponse, SessionUser } from "../../shared/types.d.ts";
import { SERVER_URL } from "./config.ts";

// Session storage and the REST client.
//
// Tokens live in localStorage so every tab shares one session. The access
// token is short-lived (10 min); when the API answers 401 the client asks
// POST /api/auth/refresh for a new pair and retries once. The server keeps
// only the latest refresh token, so two tabs refreshing at the same time would
// log each other out: a Web Lock makes them take turns, and a tab that waited
// reuses the token the other tab just got.

const KEY = "relay.session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  status: number;
  code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let session: Session | null = null;
const listeners = new Set<(reason: string) => void>();

const read = (): Session | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
};

const write = (value: Session | null) => {
  session = value;
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): the session lasts until the tab closes
  }
};

export const getSession = () => session;
export const getAccessToken = () => session?.accessToken ?? null;

// "ended" listeners run when the session is gone (logout here or in another
// tab, refresh token rejected). They receive a reason for the login screen.
export const onSessionEnded = (fn: (reason: string) => void) => listeners.add(fn);
const endSession = (reason: string) => {
  if (!session) return;
  write(null);
  listeners.forEach((fn) => fn(reason));
};

export const restoreSession = () => {
  session = read();
  return session;
};

// Another tab logged in, refreshed or logged out
window.addEventListener("storage", (event) => {
  if (event.key !== KEY) return;
  const next = read();
  if (!next && session) {
    session = null;
    listeners.forEach((fn) => fn("You signed out in another tab."));
  } else if (next && session && next.user._id === session.user._id) {
    session = next;
  }
});

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

const request = async <T>(path: string, { method = "GET", body, token }: RequestOptions = {}): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "NETWORK");
  }
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!res.ok || !json || json.status !== "success") {
    const message = json && json.status !== "success" ? json.message : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return json.data;
};

const withLock = <T>(name: string, fn: () => Promise<T>): Promise<T> =>
  navigator.locks?.request ? navigator.locks.request(name, fn) : fn();

// Returns a fresh access token, or ends the session
export const refreshTokens = async (staleToken: string | null = getAccessToken()) =>
  withLock("relay-token-refresh", async () => {
    // Another tab refreshed while we waited for the lock
    const stored = read();
    if (stored?.accessToken && stored.accessToken !== staleToken) {
      session = stored;
      return stored.accessToken;
    }
    if (!session?.refreshToken) throw new ApiError("Not signed in", 401);
    try {
      const tokens = await request<Tokens>("/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } });
      write({ ...session, ...tokens });
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) endSession("Your session expired. Please sign in again.");
      throw err;
    }
  });

// Authenticated request with one automatic refresh-and-retry on 401
export const api = async <T>(path: string, options: Omit<RequestOptions, "token"> = {}): Promise<T> => {
  const token = getAccessToken();
  try {
    return await request<T>(path, { ...options, token });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || !session) throw err;
    const fresh = await refreshTokens(token);
    return request<T>(path, { ...options, token: fresh });
  }
};

export const login = async (email: string, password: string) => {
  const data = await request<Session>("/auth/login", { method: "POST", body: { email, password } });
  write(data);
  return data.user;
};

export const register = async (fields: Record<string, string>) => {
  const data = await request<Session>("/auth/register", { method: "POST", body: fields });
  write(data);
  return data.user;
};

export const logout = async () => {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // Signing out locally is what matters
  }
  write(null);
};
