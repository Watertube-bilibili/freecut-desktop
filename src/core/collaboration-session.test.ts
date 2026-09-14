import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollaborationSession, disconnectedCollaboration } from './collaboration-session';
import { createProject, createClip } from './project';
import type { CollaborationAPI, CollaborationProjectEvent, CollaborationPublishResult, CollaborationState } from '../collaboration-types';

function fixture() {
  let project = createProject();
  project.clips = [createClip('shape', project.tracks[0].id), createClip('shape', project.tracks[0].id)];
  let state: CollaborationState = { ...disconnectedCollaboration, peerId: 'local' };
  let eventListener = (_event: CollaborationProjectEvent) => {};
  let stateListener = (_state: CollaborationState) => {};
  const publish = vi.fn<CollaborationAPI['publish']>();
  const api: CollaborationAPI = {
    state: async () => state,
    host: async () => {
      state = { ...state, mode: 'hosting', revision: 0 };
      stateListener(state);
      return state;
    },
    join: vi.fn(),
    leave: async () => { state = { ...state, mode: 'disconnected' }; stateListener(state); return state; },
    publish,
    onState: callback => { stateListener = callback; return () => {}; },
    onProject: callback => { eventListener = callback; return () => {}; },
  };
  let allowed = true;
  const conflict = vi.fn(), apply = vi.fn((value: typeof project) => { project = value; });
  const session = new CollaborationSession(api, {
    read: () => project, apply, canApply: () => allowed,
    state: () => {}, conflict, error: vi.fn(),
  });
  session.start();
  return {
    session, publish, conflict, apply, api,
    get project() { return project; }, set project(value) { project = value; },
    emit: (event: CollaborationProjectEvent) => eventListener(event),
    allowed: (value: boolean) => { allowed = value; },
  };
}
afterEach(() => vi.useRealTimers());
describe('collaboration client draft preservation', () => {
  it.each(['leave', 'disconnect'] as const)('publishes after %s without old cleanup unlocking the new upload', async (departure) => {
    vi.useFakeTimers();
    const f = fixture();
    await f.session.host(45823, 'old room');
    f.project = { ...f.project, name: 'old upload' };
    let resolveOld!: (result: CollaborationPublishResult) => void;
    let resolveNew!: (result: CollaborationPublishResult) => void;
    f.publish.mockImplementationOnce(() => new Promise(done => { resolveOld = done; }));
    f.publish.mockImplementationOnce(() => new Promise(done => { resolveNew = done; }));
    f.publish.mockImplementation(async ({ project }) => ({ ok: true, project, revision: 2, originId: 'local' }));
    const oldUpload = f.session.flush();
    const oldSnapshot = structuredClone(f.publish.mock.calls[0][0].project);
    if (departure === 'leave') await f.session.leave();
    else await f.api.leave(); // Simulate an unsolicited disconnected state event.
    await f.session.host(45824, 'new room');
    f.project = { ...f.project, name: 'new upload' };
    const newUpload = f.session.flush();
    expect(f.publish).toHaveBeenCalledTimes(2);
    const newSnapshot = structuredClone(f.publish.mock.calls[1][0].project);
    f.project = { ...f.project, name: 'typed while new upload is pending' };
    resolveOld({ ok: true, project: oldSnapshot, revision: 1, originId: 'old' });
    await oldUpload;
    await f.session.flush();
    expect(f.publish).toHaveBeenCalledTimes(2);
    expect(f.project.name).toBe('typed while new upload is pending');
    resolveNew({ ok: true, project: newSnapshot, revision: 1, originId: 'local' });
    await newUpload;
    await f.session.flush();
    expect(f.publish).toHaveBeenCalledTimes(3);
    expect(f.publish.mock.calls[2][0].project.name).toBe('typed while new upload is pending');
    f.session.dispose();
  });
  it('invalidates a pending join when disconnected before its reply', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (event: CollaborationProjectEvent) => void;
    f.api.join = vi.fn(() => new Promise<CollaborationProjectEvent>(done => { resolve = done; }));
    const joining = f.session.join({ host: '127.0.0.1', port: 45823, key: 'key' });
    await f.api.leave();
    resolve({ project: createProject(), revision: 0, originId: 'old' });
    await joining;
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.session.state.mode).toBe('disconnected');
    f.session.dispose();
  });
  it('retains a newer room event that arrives before the join reply', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (event: CollaborationProjectEvent) => void;
    f.api.join = vi.fn(() => new Promise<CollaborationProjectEvent>(done => { resolve = done; }));
    const initial = { ...createProject(), name: 'room before another peer edits' };
    const newer = { ...initial, name: 'room after another peer edits' };
    const joining = f.session.join({ host: '127.0.0.1', port: 45823, key: 'key' });
    f.emit({ project: newer, revision: 1, originId: 'peer' });
    resolve({ project: initial, revision: 0, originId: 'host' });
    await joining;
    f.session.state = { ...disconnectedCollaboration, mode: 'joined', peerId: 'local', revision: 1 };
    await f.session.flush();
    expect(f.project.name).toBe(newer.name);
    expect(f.publish).not.toHaveBeenCalled();
    f.session.dispose();
  });
  it('preserves edits made while an incoming room is still downloading', async () => {
    vi.useFakeTimers(); const f = fixture();
    let resolve!: (event: CollaborationProjectEvent) => void;
    f.api.join = vi.fn(() => new Promise<CollaborationProjectEvent>(done => { resolve = done; }));
    const incoming = { ...createProject(), name: 'room' };
    const joining = f.session.join({ host: '127.0.0.1', port: 45823, key: 'key' });
    f.project = { ...f.project, name: 'new local edits while joining' };
    resolve({ project: incoming, revision: 0, originId: 'host' }); await joining;
    expect(f.project.name).toBe('new local edits while joining');
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.conflict).toHaveBeenCalledWith(['join.local-changes']);
    f.session.adoptRemote(); expect(f.apply).toHaveBeenLastCalledWith(incoming, true);
    f.session.dispose();
  });
  it('does not republish unchanged projects with reordered JSON keys or absent optional values', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    f.project = Object.fromEntries(Object.entries(f.project).reverse()) as typeof f.project;
    f.project.clips = f.project.clips.map(clip => ({ ...clip, audio: undefined }));
    await f.session.flush(); expect(f.publish).not.toHaveBeenCalled(); f.session.dispose();
  });
  it('preserves the draft if merging a remote track deletion leaves a local clip without its track', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    const remote = structuredClone(f.project), id = remote.tracks[0].id;
    remote.tracks = remote.tracks.filter(track => track.id !== id);
    remote.clips = [];
    f.project = { ...f.project, clips: [...f.project.clips, createClip('shape', id)] };
    f.emit({ project: remote, revision: 1, originId: 'peer' }); await f.session.flush();
    expect(f.project.clips).toHaveLength(3);
    expect(f.conflict).toHaveBeenCalledWith(['project.references']);
    expect(f.apply).not.toHaveBeenCalled(); f.session.dispose();
  });
  it('merges remote changes with unsent local edits on a different clip', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    const remote = structuredClone(f.project); remote.clips[1].name = 'remote';
    f.project = structuredClone(f.project); f.project.clips[0].name = 'local';
    f.publish.mockImplementation(async ({ project }) => ({ ok: true, project, revision: 2, originId: 'local' }));
    f.emit({ project: remote, revision: 1, originId: 'peer' });
    await f.session.flush();
    expect(f.project.clips.map(clip => clip.name)).toEqual(['local', 'remote']);
    expect(f.publish.mock.calls[0][0].baseRevision).toBe(1);
    f.session.dispose();
  });
  it('rebases edits made during an in-flight publish instead of overwriting them', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    f.project = { ...f.project, name: 'sent' };
    let resolve!: (result: CollaborationPublishResult) => void;
    f.publish.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.session.flush();
    const sent = structuredClone(f.publish.mock.calls[0][0].project);
    f.project = { ...f.project, name: 'typed while uploading' };
    sent.clips[1].name = 'peer changed another clip';
    resolve({ ok: true, project: sent, revision: 1, originId: 'local' }); await pending;
    expect(f.project.name).toBe('typed while uploading');
    expect(f.project.clips[1].name).toBe('peer changed another clip');
    f.publish.mockImplementation(async ({ project }) => ({ ok: true, project, revision: 2, originId: 'local' }));
    await f.session.flush();
    expect(f.publish.mock.calls[1][0].project.name).toBe('typed while uploading');
    expect(f.publish.mock.calls[1][0].baseRevision).toBe(1);
    f.session.dispose();
  });
  it('keeps a conflicting local draft until the user explicitly adopts the room version', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    const remote = { ...f.project, name: 'remote' };
    f.project = { ...f.project, name: 'local' };
    f.emit({ project: remote, revision: 1, originId: 'peer' }); await f.session.flush();
    expect(f.project.name).toBe('local'); expect(f.conflict).toHaveBeenCalledWith(['project.name']);
    expect(f.publish).not.toHaveBeenCalled();
    f.session.adoptRemote(); expect(f.project.name).toBe('remote');
    f.session.dispose();
  });
  it('does not apply a late acknowledgement after leaving', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    f.project = { ...f.project, name: 'local' };
    let resolve!: (result: CollaborationPublishResult) => void;
    f.publish.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.session.flush(); await f.session.leave();
    resolve({ ok: true, project: { ...f.project, name: 'stale' }, revision: 1, originId: 'local' }); await pending;
    expect(f.project.name).toBe('local'); expect(f.apply).not.toHaveBeenCalled();
    f.session.dispose();
  });
  it('defers acknowledgements while a preview gesture or file dialog owns the draft', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.host(45823, 'A');
    f.project = { ...f.project, name: 'local' };
    let resolve!: (result: CollaborationPublishResult) => void;
    f.publish.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.session.flush();
    const result = structuredClone(f.project); result.clips[1].name = 'remote';
    f.allowed(false); resolve({ ok: true, project: result, revision: 1, originId: 'local' }); await pending;
    expect(f.apply).not.toHaveBeenCalled();
    f.allowed(true); await f.session.flush();
    expect(f.project.clips[1].name).toBe('remote'); f.session.dispose();
  });
});
