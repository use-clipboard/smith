'use client';

import { useTimesheets } from '../TimesheetsProvider';
import TimerStartModal from './TimerStartModal';

/**
 * Hosts the "start a timer" modal at the app root so it can be opened from
 * anywhere (the header shortcut, the in-tool button) via the provider's
 * openStartModal(). Renders nothing until opened.
 */
export default function GlobalTimerStartModal() {
  const { startModalOpen, closeStartModal } = useTimesheets();
  if (!startModalOpen) return null;
  return <TimerStartModal onClose={closeStartModal} />;
}
