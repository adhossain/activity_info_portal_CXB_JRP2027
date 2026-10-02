import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { api } from "./api.js";

interface AuthState {
  loading: boolean;
  email: string | null;
  login: (email: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((u) => setEmail(u.email))
      .catch(() => setEmail(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, token: string) => {
    const res = await api.login(email, token);
    setEmail(res.email);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setEmail(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, email, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
