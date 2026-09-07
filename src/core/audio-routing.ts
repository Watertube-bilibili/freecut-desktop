import type { AudioSettings } from '../types';

export const defaultAudio = (): AudioSettings => ({ pan: 0, leftGain: 1, rightGain: 1, channelMode: 'stereo' });

/** Output rows [left, right], input columns [left, right]. The centre position
 * preserves stereo levels; balance attenuates the opposite side without boosting. */
export function audioMatrix(settings?: AudioSettings): [number, number, number, number] {
  const audio = { ...defaultAudio(), ...settings };
  const left = audio.leftGain * (audio.pan > 0 ? 1 - audio.pan : 1);
  const right = audio.rightGain * (audio.pan < 0 ? 1 + audio.pan : 1);
  switch (audio.channelMode) {
    case 'left': return [left, 0, right, 0];
    case 'right': return [0, left, 0, right];
    case 'mono': return [left / 2, left / 2, right / 2, right / 2];
    case 'swap': return [0, left, right, 0];
    default: return [left, 0, 0, right];
  }
}

export function createAudioRouting(context: BaseAudioContext, source: AudioNode) {
  // Explicit speakers upmix duplicates a mono input into both sides at unity,
  // matching the exporter before applying the same channel matrix.
  const stereo = context.createGain();
  stereo.channelCount = 2; stereo.channelCountMode = 'explicit'; stereo.channelInterpretation = 'speakers';
  const splitter = context.createChannelSplitter(2), merger = context.createChannelMerger(2);
  const routes = Array.from({ length: 4 }, () => context.createGain());
  const gain = context.createGain();
  source.connect(stereo).connect(splitter);
  routes.forEach((route, index) => { splitter.connect(route, index % 2); route.connect(merger, 0, Math.floor(index / 2)); });
  merger.connect(gain);
  const set = (audio: AudioSettings | undefined, volume: number) => {
    audioMatrix(audio).forEach((value, index) => { routes[index].gain.value = value; });
    gain.gain.value = volume;
  };
  set(undefined, 1);
  return { output: gain, set, dispose: () => { source.disconnect(); stereo.disconnect(); splitter.disconnect(); routes.forEach(node => node.disconnect()); merger.disconnect(); gain.disconnect(); } };
}
