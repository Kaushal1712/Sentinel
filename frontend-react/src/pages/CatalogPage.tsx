/**
 * CatalogPage — /catalog
 *
 * Platform catalog viewer (read-only for all authenticated users).
 * Edit functionality shown only to admin/analyst users (backend enforces via require_admin).
 *
 * GET /api/catalog/platforms — available to all authenticated users
 * PUT /api/catalog/platforms — admin/analyst only (backend returns 403 otherwise)
 *
 * This page is read-only by default. Admin/analyst users see an "Edit" toggle
 * that allows inline JSON editing. The backend validates all platform entries
 * (name, url_template, category, match, confidence) before saving.
 *
 * Fields per PlatformEntry (from validate_platform_catalog()):
 *   name, url_template, category, match, dork_site, enumerate, search_priority, confidence
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { catalogApi } from '@/api/catalog';
import { isApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { PlatformEntry } from '@/types';

const MATCH_COLORS: Record<string, string> = {
  path:      'bg-accent-blue/10 text-accent-blue',
  query:     'bg-accent-purple/10 text-accent-purple',
  subdomain: 'bg-accent-amber/10 text-accent-amber',
};

function PlatformRow({ entry }: { entry: PlatformEntry }) {
  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="px-3 py-2.5">
        <p className="text-xs font-semibold text-text-primary">{entry.name}</p>
        <p className="text-[10px] font-mono text-text-tertiary truncate max-w-[200px]" title={entry.url_template}>
          {entry.url_template}
        </p>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-[10px] text-text-secondary capitalize">{entry.category}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${MATCH_COLORS[entry.match] ?? 'bg-white/5 text-text-tertiary'}`}>
          {entry.match}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-[10px] ${entry.enumerate ? 'text-accent-green' : 'text-text-tertiary'}`}>
          {entry.enumerate ? '✓' : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-[10px] ${entry.search_priority ? 'text-accent-amber' : 'text-text-tertiary'}`}>
          {entry.search_priority ? '★' : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[10px] font-mono text-text-secondary">
          {(entry.confidence * 100).toFixed(0)}%
        </span>
      </td>
    </tr>
  );
}

export function CatalogPage() {
  const { currentUser: user } = useAuth();
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editJson, setEditJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');

  const isAdmin = user?.role === 'admin' || user?.role === 'analyst';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['catalog'] as const,
    queryFn: () => catalogApi.get(),
    staleTime: 60_000,
    retry: 2,
  });

  const saveMutation = useMutation({
    mutationFn: (platforms: PlatformEntry[]) => catalogApi.update(platforms),
    onSuccess: () => {
      setEditMode(false);
      setJsonError(null);
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) => {
      if (isApiError(err)) setJsonError(err.error ?? 'Save failed.');
      else setJsonError('Save failed. Please try again.');
    },
  });

  function handleEdit() {
    if (!data) return;
    setEditJson(JSON.stringify(data.catalog.platforms, null, 2));
    setJsonError(null);
    setEditMode(true);
  }

  function handleSave() {
    setJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(editJson);
    } catch {
      setJsonError('Invalid JSON. Please fix the syntax and try again.');
      return;
    }
    if (!Array.isArray(parsed)) {
      setJsonError('The catalog must be a JSON array of platform objects.');
      return;
    }
    saveMutation.mutate(parsed as PlatformEntry[]);
  }

  const platforms = data?.catalog.platforms ?? [];
  const summary = data?.summary;

  const categories = summary?.categories ?? {};
  const categoryKeys = Object.keys(categories).sort();

  const filtered = filterCat
    ? platforms.filter((p) => p.category === filterCat)
    : platforms;

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-5 p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Platform Catalog</h1>
            <p className="mt-1 text-sm text-text-tertiary">
              {summary
                ? `${summary.total_platforms} platforms across ${categoryKeys.length} categories`
                : 'Platforms used during digital footprint scans'}
            </p>
          </div>
          {isAdmin && !editMode && (
            <Button variant="secondary" size="sm" id="btn-edit-catalog" onClick={handleEdit}>
              Edit Catalog
            </Button>
          )}
          {editMode && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" id="btn-cancel-catalog" onClick={() => { setEditMode(false); setJsonError(null); }}>
                Cancel
              </Button>
              <Button size="sm" id="btn-save-catalog" disabled={saveMutation.isPending} onClick={handleSave}>
                {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {isError && (
          <Card>
            <ErrorState title="Failed to load catalog" error={error} onRetry={() => void refetch()} />
          </Card>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Total', value: summary?.total_platforms ?? 0 },
                { label: 'Enumerated', value: summary?.enumerated_platforms ?? 0 },
                { label: 'Priority', value: summary?.search_priority_platforms ?? 0 },
                { label: 'Categories', value: categoryKeys.length },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/[0.07] bg-bg-card px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{value}</p>
                </div>
              ))}
            </div>

            {/* Edit mode — raw JSON editor */}
            {editMode ? (
              <Card>
                <p className="mb-2 text-xs text-text-secondary">
                  Edit the platform catalog as JSON. Each entry requires: <code>name</code>, <code>url_template</code> (with one <code>{'{}'}</code>), <code>category</code>, <code>match</code> (path|query|subdomain), <code>confidence</code> (0–1).
                </p>
                {jsonError && (
                  <p role="alert" className="mb-2 text-xs text-accent-red">{jsonError}</p>
                )}
                <textarea
                  id="catalog-json-editor"
                  value={editJson}
                  onChange={(e) => setEditJson(e.target.value)}
                  rows={20}
                  spellCheck={false}
                  className="w-full rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent-blue/40 resize-y"
                  aria-label="Catalog JSON editor"
                />
              </Card>
            ) : (
              <>
                {/* Category filter */}
                {categoryKeys.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      id="btn-catalog-filter-all"
                      onClick={() => setFilterCat('')}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${!filterCat ? 'bg-accent-blue/15 text-accent-blue' : 'border border-white/[0.10] text-text-tertiary hover:text-text-secondary'}`}
                    >
                      All ({platforms.length})
                    </button>
                    {categoryKeys.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        id={`btn-catalog-filter-${cat}`}
                        onClick={() => setFilterCat(cat === filterCat ? '' : cat)}
                        className={`rounded-full px-3 py-1 text-xs capitalize transition-colors ${filterCat === cat ? 'bg-accent-blue/15 text-accent-blue' : 'border border-white/[0.10] text-text-tertiary hover:text-text-secondary'}`}
                      >
                        {cat} ({categories[cat]})
                      </button>
                    ))}
                  </div>
                )}

                {/* Platform table */}
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-white/[0.08] text-left">
                          {['Platform / URL Template', 'Category', 'Match', 'Enumerate', 'Priority', 'Confidence'].map((h) => (
                            <th key={h} className="px-3 py-2 font-medium text-text-tertiary">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((entry) => (
                          <PlatformRow key={entry.name} entry={entry} />
                        ))}
                      </tbody>
                    </table>
                    {filtered.length === 0 && (
                      <p className="py-6 text-center text-sm text-text-tertiary">No platforms in this category.</p>
                    )}
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
