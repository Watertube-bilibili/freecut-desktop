import type { Clip, Project, Track } from '../types';

const EPS = 1e-8;
const MAX_TIME = 24 * 60 * 60;
const uid = () => globalThis.crypto.randomUUID();

/** Selection order is stable; stale and repeated IDs are ignored. */
export function selectedClips(project: Project, ids: readonly string[]): Clip[] {
  const clips = new Map(project.clips.map((clip) => [clip.id, clip]));
  return [...new Set(ids)].flatMap((id) => {
    const clip = clips.get(id);
    return clip ? [clip] : [];
  });
}

export function editableSelection(project: Project, ids: readonly string[]): Clip[] {
  const unlocked = new Set(
    project.tracks.filter((track) => !track.locked).map((track) => track.id),
  );
  return selectedClips(project, ids).filter((clip) => unlocked.has(clip.trackId));
}

/** Matches media import: an audio lane accepts audio; picture lanes may include audio. */
export function trackAcceptsClip(track: Track, clip: Clip): boolean {
  return track.kind !== 'audio' || clip.kind === 'audio';
}

export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

/** Every preview is calculated from the gesture's original project, so many moves make one undo. */
export function moveSelection(
  project: Project,
  ids: readonly string[],
  deltaTime: number,
  trackOffset = 0,
): Project {
  const clips = editableSelection(project, ids);
  if (!clips.length || !Number.isFinite(deltaTime) || !Number.isInteger(trackOffset))
    return project;
  const targets = new Map<string, string>();
  for (const clip of clips) {
    const index = project.tracks.findIndex((track) => track.id === clip.trackId);
    const target = project.tracks[index + trackOffset];
    if (!target || target.locked || !trackAcceptsClip(target, clip)) return project;
    targets.set(clip.id, target.id);
  }
  // Round the common delta, not individual starts: imported subframe offsets stay intact.
  const delta = Math.max(
    -Math.min(...clips.map((clip) => clip.start)),
    Math.min(
      MAX_TIME - Math.max(...clips.map((clip) => clip.start + clip.duration)),
      Math.round(deltaTime * project.fps) / project.fps,
    ),
  );
  if (Math.abs(delta) < EPS && trackOffset === 0) return project;
  return {
    ...project,
    clips: project.clips.map((clip) =>
      targets.has(clip.id)
        ? { ...clip, start: Math.max(0, clip.start + delta), trackId: targets.get(clip.id)! }
        : clip,
    ),
  };
}

export function copySelection(project: Project, ids: readonly string[]): Clip[] {
  return structuredClone(selectedClips(project, ids));
}

export type SelectionEditError =
  | 'locked'
  | 'incompatible'
  | 'missing-track'
  | 'missing-asset'
  | 'range'
  | 'ripple-overlap';
export interface SelectionEdit {
  project: Project;
  ids: string[];
  error?: SelectionEditError;
}

function cloneForPlacement(clip: Clip, trackId: string, start: number): Clip {
  const copy = structuredClone(clip);
  copy.id = uid();
  copy.trackId = trackId;
  copy.start = start;
  Object.values(copy.keyframes).forEach((points) => points?.forEach((point) => (point.id = uid())));
  return copy;
}

/** Paste the earliest clip at the playhead, retaining gaps and relative track positions. */
export function pasteSelection(
  project: Project,
  clipboard: readonly Clip[],
  atTime: number,
  targetTrackId?: string,
): SelectionEdit {
  const fail = (error: SelectionEditError): SelectionEdit => ({ project, ids: [], error });
  if (!clipboard.length) return { project, ids: [] };
  if (!Number.isFinite(atTime)) return fail('range');
  const start = Math.max(0, Math.round(atTime * project.fps) / project.fps);
  const earliest = Math.min(...clipboard.map((clip) => clip.start));
  // The first copied clip is the track anchor; preserve the order stored in the clipboard.
  const sourceIndex = project.tracks.findIndex((track) => track.id === clipboard[0].trackId);
  const destinationIndex = targetTrackId
    ? project.tracks.findIndex((track) => track.id === targetTrackId)
    : sourceIndex;
  if (sourceIndex < 0 || destinationIndex < 0) return fail('missing-track');
  const offset = destinationIndex - sourceIndex;
  const placements: { clip: Clip; target: Track; start: number }[] = [];
  for (const clip of clipboard) {
    const index = project.tracks.findIndex((track) => track.id === clip.trackId);
    const target = index < 0 ? undefined : project.tracks[index + offset];
    if (!target) return fail('missing-track');
    if (target.locked) return fail('locked');
    if (!trackAcceptsClip(target, clip)) return fail('incompatible');
    if (clip.assetId && !project.assets.some((asset) => asset.id === clip.assetId))
      return fail('missing-asset');
    const placedStart = start + clip.start - earliest;
    if (!Number.isFinite(placedStart) || placedStart + clip.duration > MAX_TIME + EPS)
      return fail('range');
    placements.push({ clip, target, start: placedStart });
  }
  if (project.clips.length + placements.length > 10_000) return fail('range');
  const clones = placements.map(({ clip, target, start: placedStart }) =>
    cloneForPlacement(clip, target.id, placedStart),
  );
  return {
    project: { ...project, clips: [...project.clips, ...clones] },
    ids: clones.map((clip) => clip.id),
  };
}

export function duplicateSelection(project: Project, ids: readonly string[]): SelectionEdit {
  const clips = editableSelection(project, ids);
  if (!clips.length) return { project, ids: selectedClips(project, ids).map((clip) => clip.id) };
  return pasteSelection(
    project,
    clips,
    Math.ceil((Math.max(...clips.map((clip) => clip.start + clip.duration)) - EPS) * project.fps) /
      project.fps,
  );
}

export function unionClipRanges(clips: readonly Clip[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const last = ranges.at(-1);
    const end = clip.start + clip.duration;
    if (last && clip.start <= last[1] + EPS) last[1] = Math.max(last[1], end);
    else ranges.push([clip.start, end]);
  }
  return ranges;
}

/** Ripple closes the union of removed time intervals on every unlocked track.
 * If any surviving unlocked clip crosses an interval, reject the entire operation:
 * never silently truncate, split, overlap or time-stretch existing content. */
export function deleteSelection(
  project: Project,
  ids: readonly string[],
  ripple = false,
): SelectionEdit {
  const removed = editableSelection(project, ids);
  const removedIds = new Set(removed.map((clip) => clip.id));
  const remainingIds = selectedClips(project, ids)
    .filter((clip) => !removedIds.has(clip.id))
    .map((clip) => clip.id);
  if (!removed.length) return { project, ids: remainingIds };
  const survivors = project.clips.filter((clip) => !removedIds.has(clip.id));
  if (!ripple) return { project: { ...project, clips: survivors }, ids: remainingIds };
  const ranges = unionClipRanges(removed);
  const unlocked = new Set(
    project.tracks.filter((track) => !track.locked).map((track) => track.id),
  );
  const crosses = survivors.some(
    (clip) =>
      unlocked.has(clip.trackId) &&
      ranges.some(
        ([start, end]) => clip.start < end - EPS && clip.start + clip.duration > start + EPS,
      ),
  );
  if (crosses) return { project, ids: [...ids], error: 'ripple-overlap' };
  return {
    project: {
      ...project,
      clips: survivors.map((clip) => {
        if (!unlocked.has(clip.trackId)) return clip;
        const shift = ranges.reduce(
          (sum, [start, end]) => sum + (end <= clip.start + EPS ? end - start : 0),
          0,
        );
        return shift > EPS ? { ...clip, start: Math.max(0, clip.start - shift) } : clip;
      }),
    },
    ids: remainingIds,
  };
}

export interface SelectionRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function rectanglesIntersect(a: SelectionRectangle, b: SelectionRectangle): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
