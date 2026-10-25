/**
 * Sentinel — typed fetch API client.
 *
 * Design decisions:
 *
 * 1. JWT is stored in an httpOnly cookie by the Flask backend.  The browser
 *    sends it automatically via `credentials: "same-origin"`.  We NEVER read,
 *    store, or manually attach the JWT token.
 *
 * 2. CSRF protection: Flask-JWT-Extended sets a readable `csrf_access_token`
 *    cookie.  For any state-changing method (POST/PUT/PATCH/DELETE) we read
 *    that cookie and send it as the `X-CSRF-TOKEN` header.  GET/HEAD/OPTIONS
 *    are idempotent and do not require CSRF protection.
 *
 * 3. All responses are parsed as JSON when the Content-Type is
 *    `application/json`; otherwise the raw text is returned.  Binary export
 *    endpoints (PDF, CSV, STIX) should be accessed via `window.open()` or
 *    anchor download — not through this client.
 *
 * 4. Non-2xx responses are thrown as `ApiError` objects so every call site
 *    can inspect `error.status` to branch on 401/403/429 etc.
 */

import type { ApiError } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Safe HTTP methods that do not mutate state and therefore don't need CSRF. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Read a cookie by name from `document.cookie`.
 * Returns an empty string when the cookie is absent.
 */
function getCookie(name: string): string {
  const entry = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split('=').slice(1).join('=')) : '';
}

/**
 * Return the current CSRF token.  The backend (Flask-JWT-Extended) stores it
 * in the readable `csrf_access_token` cookie.
 */
export function getCsrfToken(): string {
  return getCookie('csrf_access_token');
}

// ── Core request function ─────────────────────────────────────────────────────

/**
 * Execute a typed HTTP request against the Flask backend.
 *
 * @template T - Expected shape of the successful response body.
 * @param endpoint - Path relative to the API root, e.g. `/api/auth/me`.
 * @param options  - Standard `RequestInit` options (method, body, headers…).
 * @returns Parsed response body cast to `T`.
 * @throws `ApiError` for any non-2xx HTTP response, or a network-level error.
 */
export async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Set Content-Type to JSON for non-FormData bodies.
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Attach CSRF token for state-changing requests.
  if (!SAFE_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) {
      headers['X-CSRF-TOKEN'] = csrf;
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      method,
      headers,
      // Send the httpOnly JWT cookie automatically — never extracted manually.
      credentials: 'same-origin',
    });
  } catch (networkError) {
    // TypeError = no network / CORS (dev misconfiguration) / service down.
    throw {
      status: 0,
      error: 'Network error. Is the server running?',
    } satisfies ApiError;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const data: unknown = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    // Normalise backend error shapes into ApiError.
    if (typeof data === 'object' && data !== null) {
      throw { status: response.status, ...(data as Record<string, unknown>) } as ApiError;
    }
    throw {
      status: response.status,
      error: typeof data === 'string' && data ? data : 'Request failed',
    } satisfies ApiError;
  }

  return data as T;
}

// ── Type guard ────────────────────────────────────────────────────────────────

/**
 * Returns `true` when `err` is an `ApiError` thrown by this client.
 * Useful in catch blocks to distinguish API errors from programming errors.
 *
 * @example
 * try {
 *   await api.auth.login(email, password);
 * } catch (err) {
 *   if (isApiError(err) && err.status === 401) { ... }
 * }
 */
export function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as ApiError).status === 'number'
  );
}

/**
 * Submit a FormData payload (e.g. file upload).
 *
 * The Content-Type header is intentionally NOT set so the browser can include
 * the multipart boundary automatically.  The existing `request()` already
 * skips Content-Type for FormData bodies; this alias is provided for clarity
 * at call sites that perform file uploads.
 */
export function requestFormData<T>(endpoint: string, formData: FormData): Promise<T> {
  return request<T>(endpoint, { method: 'POST', body: formData });
}
