import type { Project } from '../types';
import type {
  CollaborationAPI, CollaborationJoinOptions, CollaborationProjectEvent, CollaborationState,
} from '../collaboration-types';
import { mergeProjects, sameJSON } from '../../electron/collaboration-merge.mjs';
import { validateProject } from './project';

export const disconnectedCollaboration: CollaborationState = {
  mode: 'disconnected', peerId: '', revision: 0, addresses: [], port: 45823, peers: [], message: '',
};

type Callbacks = {
  read: () => Project;
  apply: (project: Project, initial: boolean) => void;
  canApply: () => boolean;
  state: (state: CollaborationState) => void;
  conflict: (fields: string[]) => void;
  error: (error: string) => void;
};

/** Rebase edits made while the network is busy; never overwrite an unsent draft. */
export class CollaborationSession {
  private base?: CollaborationProjectEvent;
  private latest?: CollaborationProjectEvent;
  private conflicted = false;
  private sending = false;
  private acknowledgement?: { event: CollaborationProjectEvent; sent: Project };
  private connecting = false;
  private pendingInitial = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stops: (() => void)[] = [];
  state = disconnectedCollaboration;
  constructor(private api: CollaborationAPI, private callbacks: Callbacks) {}
  start() {
    const generation = this.generation;
    this.stops.push(this.api.onState(state => {
      this.state = state;
      this.callbacks.state(state);
      if (state.mode === 'disconnected' &&
          (this.base || this.connecting || this.sending || this.latest || this.pendingInitial))
        this.resetConnection();
    }), this.api.onProject(event => {
      if (!this.latest || event.revision > this.latest.revision) this.latest = event;
      this.schedule();
    }));
    void this.api.state().then(state => {
      if (this.stops.length && generation === this.generation) { this.state = state; this.callbacks.state(state); }
    }).catch(error => this.callbacks.error(String(error.message ?? error)));
  }
  dispose() {
    this.generation++;
    clearTimeout(this.timer);
    this.stops.splice(0).forEach(stop => stop());
  }
  async host(port: number, name: string) {
    const generation = ++this.generation;
    const snapshot = structuredClone(this.callbacks.read());
    this.connecting = true;
    this.callbacks.error('');
    try {
      const state = await this.api.host({ project: snapshot, port, name });
      if (generation !== this.generation) return;
      this.state = state;
      this.base = { project: snapshot, revision: state.revision, originId: state.peerId };
      this.callbacks.state(state);
    } finally {
      if (generation === this.generation) { this.connecting = false; this.schedule(); }
    }
  }
  async join(options: CollaborationJoinOptions) {
    const generation = ++this.generation;
    const before = structuredClone(this.callbacks.read());
    this.connecting = true;
    this.callbacks.error('');
    try {
      const event = await this.api.join(options);
      if (generation !== this.generation) return;
      this.base = event;
      if (!this.callbacks.canApply() || !sameJSON(before, this.callbacks.read())) {
        if (!this.latest || this.latest.revision <= event.revision) this.latest = event;
        this.pendingInitial = true;
        this.conflicted = true;
        this.callbacks.conflict(['join.local-changes']);
      } else {
        if (this.latest && this.latest.revision <= event.revision) this.latest = undefined;
        this.callbacks.apply(event.project, true);
      }
    } finally {
      if (generation === this.generation) { this.connecting = false; this.schedule(); }
    }
  }
  private resetConnection() {
    this.generation++;
    clearTimeout(this.timer);
    this.base = undefined;
    this.latest = undefined;
    this.acknowledgement = undefined;
    this.conflicted = false;
    this.pendingInitial = false;
    this.sending = false;
    this.connecting = false;
    this.callbacks.conflict([]);
  }
  async leave() {
    this.resetConnection();
    const generation = this.generation;
    const state = await this.api.leave();
    if (generation === this.generation) {
      this.state = state;
      this.callbacks.state(state);
    }
  }
  projectChanged() { this.schedule(); }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 180);
  }
  private accept(event: CollaborationProjectEvent, base = this.base?.project) {
    if (!base) return;
    const result = mergeProjects(base, this.callbacks.read(), event.project);
    if (!result.conflicts.length) {
      try { validateProject(result.project); }
      catch { result.conflicts.push('project.references'); }
    }
    if (result.conflicts.length) {
      this.latest = event;
      this.conflicted = true;
      this.callbacks.conflict(result.conflicts);
      return;
    }
    this.base = event;
    if (this.latest && this.latest.revision <= event.revision) this.latest = undefined;
    if (!sameJSON(result.project, this.callbacks.read()))
      this.callbacks.apply(result.project, false);
  }
  adoptRemote() {
    if (!this.latest) return;
    this.base = this.latest;
    this.latest = undefined;
    this.conflicted = false;
    this.callbacks.conflict([]);
    this.callbacks.apply(this.base.project, this.pendingInitial);
    this.pendingInitial = false;
    this.schedule();
  }
  async flush() {
    if (!this.base || this.sending || this.connecting || this.conflicted ||
        !['hosting', 'joined'].includes(this.state.mode)) return;
    if (!this.callbacks.canApply()) { this.schedule(); return; }
    if (this.acknowledgement) {
      const ack = this.acknowledgement;
      this.acknowledgement = undefined;
      this.accept(ack.event, ack.sent);
      if (this.conflicted) return;
    }
    if (this.latest) {
      if (this.latest.revision > this.base.revision) this.accept(this.latest);
      else this.latest = undefined;
      if (this.conflicted) return;
    }
    const snapshot = structuredClone(this.callbacks.read());
    if (sameJSON(snapshot, this.base.project)) return;
    const base = this.base;
    const generation = this.generation;
    this.sending = true;
    try {
      const result = await this.api.publish({ project: snapshot, baseRevision: base.revision });
      if (generation !== this.generation) return;
      if (!result.ok) {
        this.latest = { project: result.project, revision: result.revision, originId: '' };
        this.conflicted = true;
        this.callbacks.conflict(result.conflicts);
      } else {
        // Acknowledgement includes our sent snapshot plus any merged remote edits.
        // Rebase the edits made AFTER that snapshot, rather than sending it twice.
        if (this.callbacks.canApply()) this.accept(result, snapshot);
        else this.acknowledgement = { event: result, sent: snapshot };
        this.callbacks.error('');
      }
    } catch (error) {
      if (generation === this.generation)
        this.callbacks.error(String((error as Error).message ?? error));
    } finally {
      // An old upload may finish cancelling after a new room has already started.
      // Its cleanup must not unlock or reschedule that new room's in-flight work.
      if (generation === this.generation) {
        this.sending = false;
        // Retries wait for a user edit or a new server event after a network error.
        if (!this.conflicted &&
            (this.latest || this.acknowledgement || !sameJSON(snapshot, this.callbacks.read())))
          this.schedule();
      }
    }
  }
}
