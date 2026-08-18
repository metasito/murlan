import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { unregisterForPush } from "@/lib/pushRegistration";

export interface AuthUser {
  id: string;
  username: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "murlan_user";

/**
 * Asks the server who we are.
 *
 * Uses a raw fetch (not apiRequest) so a 401 can be told apart from a transient
 * network failure instead of being swallowed identically: only a 401 proves the
 * session is gone. `undefined` means the question was not answered — a 5xx, a
 * dropped connection — and the caller must keep whatever it already had.
 */
async function fetchMe(): Promise<AuthUser | null | undefined> {
  try {
    const baseUrl = getApiUrl().replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/auth/me`, { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) return undefined;
    return (await res.json()) as AuthUser;
  } catch {
    return undefined;
  }
}

function parseCachedUser(raw: string | null): AuthUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    /** Resolves true once the server has given a definitive answer. */
    const confirm = async (): Promise<boolean> => {
      const result = await fetchMe();
      if (cancelled) return true;
      if (result === undefined) return false;
      setUser(result);
      if (result) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      else await AsyncStorage.removeItem(STORAGE_KEY);
      return true;
    };

    (async () => {
      const cached = parseCachedUser(await AsyncStorage.getItem(STORAGE_KEY));
      if (cancelled) return;
      if (cached) setUser(cached);

      const settled = await confirm();
      if (cancelled) return;
      setLoading(false);
      if (settled) return;

      // Unanswered: the cached user stands until connectivity comes back and
      // the server can be asked again. Only an explicit false means offline —
      // null does not.
      unsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected === false) return;
        void confirm().then((done) => {
          if (!done) return;
          unsubscribe?.();
          unsubscribe = null;
        });
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const data = await res.json();
    setUser(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/register", { username, password });
    const data = await res.json();
    setUser(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, []);

  const logout = useCallback(async () => {
    // Before the session goes: the endpoint needs the cookie, and the next
    // person to sign in on this phone must not inherit these invites.
    await unregisterForPush();
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const contextValue = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
