'use client';
import { useCallback, useRef } from 'react';
import { UploadCloud, FileIcon, X } from 'lucide-react';
import Tooltip from './Tooltip';

interface FileUploadProps {
  title: string;
  /** Optional small icon shown before the title (e.g. a document-type glyph). */
  icon?: React.ReactNode;
  /** Show a required-field asterisk after the title. */
  required?: boolean;
  onFilesChange?: (files: File[]) => void;
  onFileChange?: (file: File | null) => void;
  multiple?: boolean;
  accept?: string;
  optional?: boolean;
  helpText?: string;
  existingFiles?: File[];
}

export default function FileUpload({
  title, icon, required = false, onFilesChange, onFileChange, multiple = false, accept, optional = false, helpText, existingFiles = []
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
    <div className={`backdrop-blur-md rounded-xl p-4 transition-colors ${
      hasFiles
        ? 'bg-[var(--accent-light)]/70 ring-1 ring-[var(--accent)]/40'
        : 'bg-white/[0.78]'
    }`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && <span className={`shrink-0 ${hasFiles ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{icon}</span>}
          <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">{title}{required && <span className="text-red-500 ml-0.5">*</span>}</h4>
        </div>
        {optional && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-nav-hover)] px-2 py-0.5 rounded-full">
            Optional
          </span>
        )}
      </div>
      <div
        className={`relative border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all duration-150
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
              <Tooltip label="Remove files" className="ml-1">
                <button
                  onClick={clearFiles}
                  aria-label="Remove files"
                  className="p-0.5 rounded hover:bg-[var(--accent)] hover:text-white transition-colors"
                >
                  <X size={13} className="text-[var(--accent)]" />
                </button>
              </Tooltip>
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
            <div className="flex justify-center mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-nav-hover)] flex items-center justify-center">
                <UploadCloud size={16} className="text-[var(--text-muted)]" />
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
