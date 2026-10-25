/**
 * DatasetUploadForm — file upload widget for the dataset studio.
 *
 * Accepted formats: .csv, .xlsx, .xls (confirmed from backend _validate_content).
 * Backend limits enforced server-side:
 *   - Max size: 16 MB (MAX_UPLOAD_SIZE_MB)
 *   - Max rows: 10 000 (MAX_DATASET_ROWS)
 *   - Max cols: 500 (MAX_DATASET_COLUMNS)
 *   - Max description: 1 000 chars (MAX_DATASET_DESCRIPTION_LENGTH)
 *   - Max name: 255 chars (Dataset model String(255))
 *   - Quota: 20 datasets (MAX_DATASETS_PER_USER)
 *
 * Client-side pre-validation is advisory only (extension, size).
 * The backend is authoritative on all limits.
 *
 * On success, calls onSuccess() so the parent can invalidate the list query.
 */

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/shared/Button';
import { Card } from '@/components/shared/Card';
import { datasetsApi } from '@/api/datasets';
import { isApiError } from '@/api/client';

interface DatasetUploadFormProps {
  onSuccess: () => void;
}

const ACCEPTED_EXTS = ['.csv', '.xlsx', '.xls'];
const ACCEPTED_MIME = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const MAX_SIZE_MB = 16;
const MAX_DESC_LEN = 1000;
const MAX_NAME_LEN = 255;

function getExtError(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTS.some((ext) => name.endsWith(ext))) {
    return `Unsupported file type. Accepted formats: ${ACCEPTED_EXTS.join(', ')}`;
  }
  return null;
}

function getSizeError(file: File): string | null {
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `File exceeds the ${MAX_SIZE_MB} MB limit.`;
  }
  return null;
}

export function DatasetUploadForm({ onSuccess }: DatasetUploadFormProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error('No file selected');
      return datasetsApi.upload(selectedFile, name, description);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['datasets'] });
      setSelectedFile(null);
      setName('');
      setDescription('');
      setClientError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSuccess();
    },
  });

  function handleFileSelect(file: File) {
    setClientError(null);
    const extErr = getExtError(file);
    if (extErr) { setClientError(extErr); return; }
    const sizeErr = getSizeError(file);
    if (sizeErr) { setClientError(sizeErr); return; }
    setSelectedFile(file);
    // Pre-fill name from filename stem if no name set
    if (!name.trim()) {
      const stem = file.name.replace(/\.(csv|xlsx|xls)$/i, '');
      setName(stem.slice(0, MAX_NAME_LEN));
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) { setClientError('Please select a file.'); return; }
    if (description.length > MAX_DESC_LEN) {
      setClientError(`Description must be ≤ ${MAX_DESC_LEN} characters.`);
      return;
    }
    setClientError(null);
    uploadMutation.mutate();
  }

  const serverError = uploadMutation.isError
    ? (isApiError(uploadMutation.error)
        ? uploadMutation.error.error
        : 'Upload failed. Please try again.')
    : null;

  const displayError = clientError ?? serverError;
  const isLoading = uploadMutation.isPending;

  return (
    <Card>
      <h3 className="mb-4 text-sm font-semibold text-text-primary">Upload Dataset</h3>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          id="dataset-dropzone"
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          aria-label="Drop file or click to select"
          className={[
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
            isDragging
              ? 'border-accent-blue/60 bg-accent-blue/[0.06]'
              : 'border-white/[0.12] hover:border-white/[0.22] hover:bg-white/[0.02]',
          ].join(' ')}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-text-tertiary" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {selectedFile ? (
            <>
              <p className="text-sm font-medium text-accent-blue">{selectedFile.name}</p>
              <p className="mt-1 text-xs text-text-tertiary">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB — click to change
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">Drop a file here or click to browse</p>
              <p className="mt-1 text-xs text-text-tertiary">
                {ACCEPTED_EXTS.join(', ')} · max {MAX_SIZE_MB} MB
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            id="dataset-file-input"
            type="file"
            accept={[...ACCEPTED_EXTS, ...ACCEPTED_MIME].join(',')}
            onChange={handleFileInputChange}
            className="sr-only"
            aria-hidden="true"
          />
        </div>

        {/* Name */}
        <div>
          <label htmlFor="dataset-name" className="block text-xs text-text-tertiary mb-1">
            Dataset name <span className="text-text-tertiary/60">(optional — defaults to filename)</span>
          </label>
          <input
            id="dataset-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LEN))}
            maxLength={MAX_NAME_LEN}
            placeholder="My dataset"
            className="w-full rounded-md border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="dataset-description" className="block text-xs text-text-tertiary mb-1">
            Description <span className="text-text-tertiary/60">(max {MAX_DESC_LEN} chars)</span>
          </label>
          <textarea
            id="dataset-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESC_LEN}
            placeholder="What does this dataset contain?"
            rows={3}
            className="w-full resize-none rounded-md border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20"
          />
          <p className="mt-0.5 text-right text-[10px] text-text-tertiary">
            {description.length}/{MAX_DESC_LEN}
          </p>
        </div>

        {/* Error */}
        {displayError && (
          <div
            role="alert"
            className="rounded-md border border-accent-red/25 bg-accent-red/[0.07] px-3 py-2 text-xs text-accent-red"
          >
            {displayError}
          </div>
        )}

        {/* Success */}
        {uploadMutation.isSuccess && (
          <div
            role="status"
            className="rounded-md border border-accent-green/25 bg-accent-green/[0.07] px-3 py-2 text-xs text-accent-green"
          >
            Dataset uploaded and processed successfully.
          </div>
        )}

        <Button
          type="submit"
          id="btn-upload-dataset"
          disabled={isLoading || !selectedFile}
          className="w-full"
        >
          {isLoading ? 'Uploading…' : 'Upload Dataset'}
        </Button>
      </form>
    </Card>
  );
}
