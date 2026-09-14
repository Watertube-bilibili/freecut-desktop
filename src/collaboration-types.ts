import type { Project } from './types';

export interface CollaborationPeer {
  id: string;
  name: string;
}
export interface CollaborationState {
  mode: 'disconnected' | 'hosting' | 'joined' | 'connecting';
  transport?: 'remote' | 'lan';
  phase?: 'network' | 'announcing' | 'connecting' | 'ready';
  peerId: string;
  revision: number;
  addresses: string[];
  port: number;
  peers: CollaborationPeer[];
  key?: string;
  invite?: string;
  message: string;
  error?: string;
  transferring?: boolean;
}
export type CollaborationJoinOptions =
  | { host: string; port: number; key: string; name?: string }
  | { invite: string; name?: string };
export interface CollaborationProjectEvent {
  project: Project;
  revision: number;
  originId: string;
}
export type CollaborationPublishResult =
  | ({ ok: true } & CollaborationProjectEvent)
  | { ok: false; project: Project; revision: number; conflicts: string[] };
export interface CollaborationAPI {
  host: (options: {
    project: Project;
    transport?: 'remote' | 'lan';
    port?: number;
    name?: string;
  }) => Promise<CollaborationState>;
  join: (options: CollaborationJoinOptions) => Promise<CollaborationProjectEvent>;
  leave: () => Promise<CollaborationState>;
  state: () => Promise<CollaborationState>;
  publish: (options: {
    project: Project;
    baseRevision: number;
  }) => Promise<CollaborationPublishResult>;
  onState: (callback: (state: CollaborationState) => void) => () => void;
  onProject: (callback: (event: CollaborationProjectEvent) => void) => () => void;
}
