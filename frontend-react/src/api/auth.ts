/**
 * Authentication API module.
 *
 * Covers the full set of auth endpoints used in the existing frontend:
 *   POST /api/auth/login
 *   POST /api/auth/register
 *   GET  /api/auth/me
 *   POST /api/auth/logout
 *   GET  /api/auth/google/status
 *   GET  /api/auth/google/init
 *   GET  /api/auth/digilocker/status
 *   GET  /api/auth/digilocker/init
 *
 * JWT is sent/cleared by the backend via httpOnly cookies.
 * This module never reads or stores the token value.
 */

import { request } from './client';
import type { AuthResponse, MeResponse } from '@/types';

// ── OAuth helper types ────────────────────────────────────────────────────────

export interface OAuthStatus {
  available: boolean;
  message: string;
}

export interface OAuthInitResponse {
  auth_url: string;
  state: string;
}

// ── Auth API ──────────────────────────────────────────────────────────────────

export const authApi = {
  /**
   * Authenticate with email and password.
   * On success the backend sets the JWT cookie and returns the user object.
   */
  login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  /**
   * Create a new user account.
   * On success the backend sets the JWT cookie and returns the user object.
   */
  register(fullName: string, email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ full_name: fullName, email, password }),
    });
  },

  /**
   * Return the currently authenticated user.
   * Returns 401 when the JWT cookie is absent or expired.
   */
  getCurrentUser(): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/me');
  },

  /**
   * Invalidate the current session.
   * The backend increments token_version (rotating the JWT) and clears the
   * cookie via Set-Cookie.  The JWT value is never read here.
   */
  logout(): Promise<{ message: string }> {
    return request<{ message: string }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  // ── OAuth ──────────────────────────────────────────────────────────────────

  /** Check whether the Google OAuth integration is configured on the server. */
  getGoogleStatus(): Promise<OAuthStatus> {
    return request<OAuthStatus>('/api/auth/google/status');
  },

  /**
   * Start the Google OAuth flow.
   * The returned `auth_url` should be opened in a popup window.
   * The backend stores `state` in the server-side session for CSRF protection.
   */
  initGoogle(): Promise<OAuthInitResponse> {
    return request<OAuthInitResponse>('/api/auth/google/init');
  },

  /** Check whether the DigiLocker OAuth integration is configured. */
  getDigiLockerStatus(): Promise<OAuthStatus> {
    return request<OAuthStatus>('/api/auth/digilocker/status');
  },

  /** Start the DigiLocker OAuth flow. */
  initDigiLocker(): Promise<OAuthInitResponse> {
    return request<OAuthInitResponse>('/api/auth/digilocker/init');
  },
};
