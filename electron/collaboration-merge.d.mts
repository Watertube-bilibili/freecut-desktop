import type { Project } from '../src/types';
export function sameJSON(a: unknown, b: unknown): boolean;
export function mergeProjects(base: Project, current: Project, incoming: Project): { project: Project; conflicts: string[] };
