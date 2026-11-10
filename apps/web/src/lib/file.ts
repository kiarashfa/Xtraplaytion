// Experiment files (.json): the settings of an experiment, including drawn or imported
// data, in a versioned envelope. Results are not included (the library keeps those).
import { validateState, type ExperimentState } from './share.ts';

export const FILE_FORMAT = 'xtraplaytion-experiment';
export const FILE_VERSION = 1;
/** Largest experiment file accepted. */
export const MAX_FILE = 10 * 1024 * 1024;

export interface ExperimentFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  name: string;
  saved: string;
  state: ExperimentState;
}

export type FileError = 'tooBig' | 'notJson' | 'notExperiment' | 'newer' | 'invalid';

export function experimentFile(state: ExperimentState, name: string): string {
  const file: ExperimentFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name,
    saved: new Date().toISOString(),
    state,
  };
  return JSON.stringify(file, null, 1);
}

export function readExperimentFile(
  text: string,
): { name: string; state: ExperimentState } | FileError {
  if (text.length > MAX_FILE) return 'tooBig';
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return 'notJson';
  }
  if (!o || typeof o !== 'object') return 'notExperiment';
  const f = o as Record<string, unknown>;
  if (f['format'] !== FILE_FORMAT) return 'notExperiment';
  if (typeof f['version'] !== 'number' || f['version'] > FILE_VERSION) return 'newer';
  const state = validateState(f['state']);
  if (!state) return 'invalid';
  const name = typeof f['name'] === 'string' ? f['name'].slice(0, 120) : '';
  return { name, state };
}

/** A file name from an experiment name (letters, digits, dashes). */
export function fileNameFor(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return `${base || 'experiment'}.xtraplaytion.json`;
}

/** Hands the visitor a file (download). */
export function downloadText(text: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
