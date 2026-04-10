'use client';
import { useState, useCallback, useRef } from 'react';
import DriveUploadModal from '@/components/ui/DriveUploadModal';

export interface DriveDecision {
  saveToDrive: boolean;
  clientCode: string;
}

interface PromptOptions {
  fileCount: number;
  initialClientCode?: string;
}

/**
 * Provides a Promise-based modal prompt that asks the user whether to save
 * uploaded files to Google Drive, and collects a client code for folder naming.
 *
 * Usage:
 *   const { promptDriveUpload, DriveModal } = useDriveUpload();
 *   // In your JSX: {DriveModal}
 *   // Before calling the API:
 *   const decision = await promptDriveUpload({ fileCount: files.length, initialClientCode: 'MM001' });
 *   if (!decision) return; // user cancelled
 *   // decision.saveToDrive, decision.clientCode
 */
export function useDriveUpload() {
  const [isOpen, setIsOpen] = useState(false);
  const [opts, setOpts] = useState<PromptOptions>({ fileCount: 0 });
  const resolveRef = useRef<((d: DriveDecision | null) => void) | null>(null);

  const promptDriveUpload = useCallback((options: PromptOptions): Promise<DriveDecision | null> => {
    setOpts(options);
    setIsOpen(true);
    return new Promise(resolve => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback((saveToDrive: boolean, clientCode: string) => {
    setIsOpen(false);
    resolveRef.current?.({ saveToDrive, clientCode });
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(null);
    resolveRef.current = null;
  }, []);

  const DriveModal = (
    <DriveUploadModal
      isOpen={isOpen}
      fileCount={opts.fileCount}
      initialClientCode={opts.initialClientCode ?? ''}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { promptDriveUpload, DriveModal };
}
