/**
 * useAuth — convenience hook for consuming AuthContext.
 *
 * Throws a clear error when used outside of <AuthProvider>, which prevents
 * silent failures in deeply nested components.
 */

import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error(
      'useAuth() must be called inside <AuthProvider>. ' +
        'Ensure <AuthProvider> wraps the component tree in main.tsx.',
    );
  }
  return ctx;
}
