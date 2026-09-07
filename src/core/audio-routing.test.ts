import { describe, expect, it } from 'vitest';
import { audioMatrix, defaultAudio } from './audio-routing';
import { createClip, createProject, validateProject } from './project';

describe('audio routing and project compatibility', () => {
  it('keeps legacy stereo unchanged and routes source channels independently', () => {
    expect(audioMatrix()).toEqual([1, 0, 0, 1]);
    expect(audioMatrix({ ...defaultAudio(), channelMode: 'left' })).toEqual([1, 0, 1, 0]);
    expect(audioMatrix({ ...defaultAudio(), channelMode: 'right' })).toEqual([0, 1, 0, 1]);
    expect(audioMatrix({ ...defaultAudio(), channelMode: 'mono' })).toEqual([.5, .5, .5, .5]);
    expect(audioMatrix({ ...defaultAudio(), pan: 1, leftGain: 2, rightGain: .5 })).toEqual([0, 0, 0, .5]);
  });
  it('preserves settings through project validation and rejects invalid audio values', () => {
    const project = createProject(); project.clips = [createClip('shape', 'overlay')];
    expect(validateProject(project).clips[0].audio).toBeUndefined();
    const audio = { ...defaultAudio(), pan: -.3, channelMode: 'swap' as const };
    project.clips[0].audio = audio;
    expect(validateProject(project).clips[0].audio).toEqual(audio);
    project.clips[0].audio = { ...audio, leftGain: -1 };
    expect(() => validateProject(project)).toThrow(/audio.leftGain/);
    project.clips[0].audio = { ...audio, pan: NaN };
    expect(() => validateProject(project)).toThrow(/audio.pan/);
  });
});
