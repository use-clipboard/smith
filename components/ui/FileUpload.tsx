'use client';
import { useCallback, useRef } from 'react';
import { UploadCloud, FileIcon, X } from 'lucide-react';

interface FileUploadProps {
  title: string;
  onFilesChange?: (files: File[]) => void;
  onFileChange?: (file: File | null) => void;
  multiple?: boolean;
  accept?: string;
  optional?: boolean;
  helpText?: string;
  existingFiles?: File[];
}

export default function FileUpload({
  title, onFilesChange, onFileChange, multiple = false, accept, optional = false, helpText, existingFiles = []
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (multiple && onFilesChange) {
      onFilesChange(files);
    } else if (onFileChange) {
      onFileChange(files[0] || null);
    }
  }, [multiple, onFilesChange, onFileChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (multiple && onFilesChange) {
      onFilesChange(files);
    } else if (onFileChange) {
      onFileChange(files[0] || null);
    }
  }, [multiple, onFilesChange, onFileChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const hasFiles = existingFiles.length > 0;

  function clearFiles(e: React.MouseEvent) {
    e.stopPropagation();
    if (multiple && onFilesChange) onFilesChange([]);
    else if (onFileChange) onFileChange(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="glass-solid rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
        {optional && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-nav-hover)] px-2 py-0.5 rounded-full">
            Optional
          </span>
        )}
      </div>
      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-150
          ${hasFiles
            ? 'border-[var(--accent)] bg-[var(--accent-light)]'
            : 'border-[var(--border-input)] hover:border-[var(--accent)] hover:bg-[var(--bg-nav-hover)]'
          }`}
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          className="hidden"
          onChange={handleChange}
        />
        {hasFiles ? (
          <div>
            <div className="flex items-center justify-center gap-2 mb-2">
              <FileIcon size={18} className="text-[var(--accent)]" />
              <p className="text-sm font-semibold text-[var(--accent)]">
                {existingFiles.length} file{existingFiles.length !== 1 ? 's' : ''} selected
              </p>
              <button
                onClick={clearFiles}
                className="ml-1 p-0.5 rounded hover:bg-[var(--accent)] hover:text-white transition-colors"
                title="Remove files"
              >
                <X size={13} className="text-[var(--accent)]" />
              </button>
            </div>
            <ul className="space-y-0.5">
              {existingFiles.slice(0, 3).map(f => (
                <li key={f.name} className="text-xs text-[var(--text-muted)] truncate">{f.name}</li>
              ))}
              {existingFiles.length > 3 && (
                <li className="text-xs text-[var(--text-muted)]">+{existingFiles.length - 3} more</li>
              )}
            </ul>
            <p className="text-xs text-[var(--text-muted)] mt-2">Click to replace</p>
          </div>
        ) : (
          <div>
            <div className="flex justify-center mb-3">
              <div className="w-12 h-12 rounded-xl bg-[var(--bg-nav-hover)] flex items-center justify-center">
                <UploadCloud size={22} className="text-[var(--text-muted)]" />
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="text-[var(--accent)] font-semibold">Click to upload</span> or drag and drop
            </p>
            {helpText && <p className="text-xs text-[var(--text-muted)] mt-1">{helpText}</p>}
            {accept && (
              <p className="text-[10px] text-[var(--text-muted)] mt-1.5 font-medium uppercase tracking-wide">
                {accept.replace(/application\//g, '').replace(/,/g, ' · ').replace(/image\/\*/g, 'images')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
