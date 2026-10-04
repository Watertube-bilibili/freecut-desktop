import type { Project } from './types';

export interface RecoveryEntry {
  id: string;
  sessionId: string;
  projectId: string;
  name: string;
  createdAt: string;
  saved: boolean;
  clipCount: number;
  assetCount: number;
  duration: number;
  bytes: number;
}

export interface RecoveryAPI {
  snapshot: (request: { project: Project; sessionId: string; dirty?: boolean }) => Promise<{
    status: 'saved' | 'unchanged' | 'empty' | 'clean';
    entry?: RecoveryEntry;
  }>;
  list: () => Promise<{ entries: RecoveryEntry[]; issues: number }>;
  restore: (id: string) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  markSaved: (request: { project: Project; sessionId: string }) => Promise<void>;
}
