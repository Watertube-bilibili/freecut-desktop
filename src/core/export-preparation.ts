import type { ExportOptions, Project } from '../types';
import { defaultTransform } from './project';
import { renderProject } from './renderer';

/** Prepare static title/shape textures once, leaving animated placement to the
 * native compositor. This never changes a saved project or requests media paths.
 * A texture that would clip content or change effect scale stays on the shared
 * frame renderer; correctness takes priority over selecting the faster route.
 */
export async function prepareExportRasterLayers(
  project: Project,
  width: number,
  height: number,
  shouldCancel: () => boolean = () => false,
): Promise<ExportOptions['rasterLayers']> {
  const visible = new Set(
    project.tracks.filter((t) => !t.hidden && t.kind !== 'audio').map((t) => t.id),
  );
  const clips = project.clips.filter(
    (c) => visible.has(c.trackId) && ['text', 'shape'].includes(c.kind),
  );
  if (!clips.length || clips.length > 64) return undefined;
  const textures: NonNullable<ExportOptions['rasterLayers']> = [];
  let bytes = 0;
  for (const clip of clips) {
    if (shouldCancel()) return undefined;
    // Blur/feather use screen-space radii in our renderer. Baking then scaling
    // them would change the result, so leave those projects on strict rendering.
    if (clip.effects.blur > 0 || (clip.effects.maskFeather ?? 0) > 0 || clip.effects.vignette > 0)
      return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    if (clip.kind === 'text' && clip.text) {
      const text = clip.text,
        ctx = canvas.getContext('2d')!;
      // Existing projects apply alpha separately to background, outline and
      // glyphs. Fading a precomposited texture would change their intersections.
      if (
        (text.stroke || text.background !== 'transparent') &&
        (clip.transform.opacity !== 1 ||
          clip.fadeIn > 0 ||
          clip.fadeOut > 0 ||
          (clip.keyframes.opacity?.length ?? 0) > 0)
      )
        return undefined;
      const s = width / project.width;
      ctx.font = `${text.bold ? '700' : '400'} ${text.fontSize * s}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      const lines = text.text.split('\n');
      // Conservative ink/background margin keeps long/off-stage titles out of
      // the raster path; moving such a title into frame must not lose its tail.
      const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const horizontal = text.align === 'center' ? textWidth / 2 : textWidth;
      if (
        horizontal + Math.max(24, text.fontSize) * s > width / 2 ||
        (lines.length * text.fontSize * s * 1.3) / 2 + text.fontSize * s > height / 2
      )
        return undefined;
    }
    await renderProject(
      canvas,
      {
        ...project,
        background: 'transparent',
        assets: [],
        clips: [
          {
            ...clip,
            assetId: undefined,
            start: 0,
            duration: 1,
            inPoint: 0,
            speed: 1,
            fadeIn: 0,
            fadeOut: 0,
            transform: defaultTransform(),
            keyframes: {},
          },
        ],
      },
      0,
      { width, height },
    );
    if (shouldCancel()) return undefined;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('无法准备文字图层 / Could not prepare title layer')),
        'image/png',
      ),
    );
    if (shouldCancel()) return undefined;
    bytes += blob.size;
    if (blob.size > 32 * 1024 * 1024 || bytes > 128 * 1024 * 1024) return undefined;
    textures.push({ clipId: clip.id, bytes: new Uint8Array(await blob.arrayBuffer()) });
    canvas.width = canvas.height = 1;
  }
  return textures;
}
