"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api";

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company: string | null;
  role: "customer" | "admin";
  created_at: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  googleLogin: (credential: string) => Promise<User>;
  register: (input: { email: string; password: string; fullName: string; company?: string; phone?: string }) => Promise<User>;
  logout: () => void;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("dh:logout", onLogout);
    return () => window.removeEventListener("dh:logout", onLogout);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("/auth/login", { body: { email, password } });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const googleLogin = useCallback(async (credential: string) => {
    const r = await api<{ token: string; user: User }>("/auth/google", { body: { credential } });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (input: { email: string; password: string; fullName: string; company?: string; phone?: string }) => {
    const r = await api<{ token: string; user: User }>("/auth/register", { body: input });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, googleLogin, register, logout, setUser }), [user, loading, login, googleLogin, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
