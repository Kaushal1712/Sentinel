/**
 * AuthContext — global authentication state for Sentinel.
 *
 * Architecture:
 *  - Authentication truth lives in the Flask httpOnly JWT cookie.
 *  - React state mirrors what the server says about the current user.
 *  - On mount, GET /api/auth/me is called once to hydrate state.
 *    401 → unauthenticated, any 2xx → set currentUser.
 *  - JWT token value is never stored in React state or localStorage.
 *
 * Usage:
 *   const { currentUser, isLoading, login, logout } = useAuth();
 *
 * Wrap the root of the app with <AuthProvider> (done in main.tsx).
 */

import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '@/api/auth';
import { isApiError } from '@/api/client';
import type { User } from '@/types';

// ── Context shape ─────────────────────────────────────────────────────────────

export interface AuthContextValue {
  /** Authenticated user or null when unauthenticated / still loading. */
  currentUser: User | null;
  /** True while the initial /api/auth/me request is in flight. */
  isLoading: boolean;
  /** True when currentUser is non-null and isLoading is false. */
  isAuthenticated: boolean;
  /**
   * Authenticate with email + password.
   * On success, updates currentUser.
   * On failure, throws ApiError — the caller handles the error display.
   */
  login: (email: string, password: string) => Promise<void>;
  /**
   * Register a new account.
   * On success, updates currentUser.
   * On failure, throws ApiError.
   */
  register: (fullName: string, email: string, password: string) => Promise<void>;
  /**
   * Log out the current user.
   * Always clears local state regardless of server response.
   */
  logout: () => Promise<void>;
  /**
   * Re-fetch the current user from the server.
   * Use after an OAuth flow completes to confirm the server set the cookie.
   */
  refreshUser: () => Promise<User | null>;
}

// ── Context creation ──────────────────────────────────────────────────────────

// Provide a safe default that throws if used outside the provider.
export const AuthContext = createContext<AuthContextValue | null>(null);
AuthContext.displayName = 'AuthContext';

// ── Provider ──────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Hydrate on mount ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    authApi
      .getCurrentUser()
      .then(({ user }) => {
        if (!cancelled) setCurrentUser(user);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          // 401 = unauthenticated — expected when no session exists.
          // Any other error is unexpected but we still treat as unauthenticated
          // to avoid permanently blocking the login page.
          if (!isApiError(err) || err.status !== 401) {
            console.warn('[AuthContext] Unexpected error during hydration:', err);
          }
          setCurrentUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await authApi.login(email, password);
    setCurrentUser(user);
  }, []);

  const register = useCallback(
    async (fullName: string, email: string, password: string) => {
      const { user } = await authApi.register(fullName, email, password);
      setCurrentUser(user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Clear local state even if the server call fails (e.g. already expired).
    } finally {
      setCurrentUser(null);
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    try {
      const { user } = await authApi.getCurrentUser();
      setCurrentUser(user);
      return user;
    } catch {
      setCurrentUser(null);
      return null;
    }
  }, []);

  // ── Value ──────────────────────────────────────────────────────────────────

  const value: AuthContextValue = {
    currentUser,
    isLoading,
    isAuthenticated: !isLoading && currentUser !== null,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
