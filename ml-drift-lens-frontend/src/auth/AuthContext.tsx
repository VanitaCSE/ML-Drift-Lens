import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiClient, type AuthUser } from '../services/apiClient';

type AuthStatus =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser; csrfToken: string }
  | { status: 'signedOut' }
  | { status: 'error'; message: string };

interface AuthContextValue {
  auth: AuthStatus;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshSession(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Authentication is temporarily unavailable. Try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthStatus>({ status: 'loading' });

  const refreshSession = useCallback(async () => {
    setAuth({ status: 'loading' });
    try {
      const session = await apiClient.getCurrentSession();
      if (session.authenticated && session.user && session.csrfToken) {
        apiClient.setCsrfToken(session.csrfToken);
        setAuth({
          status: 'authenticated',
          user: {
            ...session.user,
            email_verified: session.email_verified ?? session.user.email_verified ?? false,
          },
          csrfToken: session.csrfToken,
        });
      } else {
        apiClient.setCsrfToken(null);
        setAuth({ status: 'signedOut' });
      }
    } catch (error) {
      apiClient.setCsrfToken(null);
      setAuth({ status: 'error', message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    apiClient.setAuthenticationFailureHandler(() => {
      apiClient.setCsrfToken(null);
      setAuth({ status: 'signedOut' });
    });
    void refreshSession();
    return () => apiClient.setAuthenticationFailureHandler(null);
  }, [refreshSession]);

  const login = useCallback(async (email: string, password: string) => {
    apiClient.setCsrfToken(null);
    await apiClient.login(email, password);
    const session = await apiClient.getCurrentSession();
    if (!session.authenticated || !session.user || !session.csrfToken) {
      throw new Error('Login succeeded but the server session could not be restored. Try again.');
    }
    apiClient.setCsrfToken(session.csrfToken);
    setAuth({
      status: 'authenticated',
      user: session.user,
      csrfToken: session.csrfToken,
    });
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await apiClient.register(email, password);
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout();
    apiClient.setCsrfToken(null);
    setAuth({ status: 'signedOut' });
  }, []);

  const value = useMemo(
    () => ({ auth, login, register, logout, refreshSession }),
    [auth, login, register, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function getAuthErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'The request could not be completed. Check your connection and try again.';
}
