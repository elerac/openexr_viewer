import { ViewerState } from './types';

export function buildSessionDisplayName(filename: string, existingFilenames: string[]): string {
  const duplicateCount = existingFilenames.reduce((count, current) => {
    return count + (current === filename ? 1 : 0);
  }, 0);

  if (duplicateCount === 0) {
    return filename;
  }

  return `${filename} (${duplicateCount + 1})`;
}

export function pickNextSessionIndexAfterRemoval(removedIndex: number, remainingCount: number): number {
  if (removedIndex < 0 || remainingCount <= 0) {
    return -1;
  }

  return Math.min(removedIndex, remainingCount - 1);
}

export function persistActiveSessionState<T extends { id: string; state: ViewerState }>(
  sessions: T[],
  activeSessionId: string | null,
  state: ViewerState
): void {
  if (!activeSessionId) {
    return;
  }

  const session = sessions.find((item) => item.id === activeSessionId);
  if (!session) {
    return;
  }

  session.state = { ...state };
}
