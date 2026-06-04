import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/query-client";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cached) setUser(JSON.parse(cached));
        const res = await apiRequest("GET", "/api/auth/me");
        const data = await res.json();
        setUser(data);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        setUser(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
      } finally {
        setLoading(false);
      }
    })();
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
