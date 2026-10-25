/**
 * DeleteConfirmDialog — modal confirmation before dataset deletion.
 *
 * Calls DELETE /api/dataset/:id on confirm.
 * Ownership is enforced server-side (user_id filter in the backend query).
 * On success, invalidates the datasets list query.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/shared/Button';
import { datasetsApi } from '@/api/datasets';
import { isApiError } from '@/api/client';

interface DeleteConfirmDialogProps {
  datasetId: number;
  datasetName: string;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteConfirmDialog({
  datasetId,
  datasetName,
  onClose,
  onDeleted,
}: DeleteConfirmDialogProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => datasetsApi.delete(datasetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['datasets'] });
      void queryClient.removeQueries({ queryKey: ['dataset', datasetId] });
      onDeleted?.();
      onClose();
    },
  });

  const errorMsg = deleteMutation.isError
    ? (isApiError(deleteMutation.error)
        ? deleteMutation.error.error
        : 'Deletion failed. Please try again.')
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-white/[0.10] bg-bg-card p-6 shadow-xl">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-red/10">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </div>

        <h2 id="delete-dialog-title" className="text-base font-semibold text-text-primary">
          Delete dataset?
        </h2>
        <p className="mt-2 text-sm text-text-tertiary">
          <span className="font-medium text-text-secondary">"{datasetName}"</span> will be permanently deleted
          along with all associated chat history. This cannot be undone.
        </p>

        {errorMsg && (
          <div role="alert" className="mt-3 rounded-md border border-accent-red/25 bg-accent-red/[0.07] px-3 py-2 text-xs text-accent-red">
            {errorMsg}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            id="btn-delete-cancel"
            onClick={onClose}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            id="btn-delete-confirm"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
