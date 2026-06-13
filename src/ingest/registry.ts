/**
 * Source-file provenance registry (rule VOY-DOC-08).
 *
 * Every source file (transliteration, control corpus) must be registered here
 * with its SHA-256, origin URL, download date and license before any pipeline
 * step is allowed to read it. `requireRegistered` is the gate the pipeline
 * calls: it throws if the file is unknown or if its content no longer matches
 * the recorded hash.
 */
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

export interface RegistryEntry {
  /** Path relative to the repo root, e.g. "data/raw/ZL_ivtff_2b.txt". */
  path: string;
  sha256: string;
  url: string;
  /** ISO 8601 date of download or manual deposit. */
  downloadedAt: string;
  license: string;
  note?: string;
}

export interface Registry {
  files: RegistryEntry[];
}

export const DEFAULT_REGISTRY_PATH = "data/registry.json";

export async function sha256File(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

export async function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH): Promise<Registry> {
  const file = Bun.file(registryPath);
  if (!(await file.exists())) return { files: [] };
  return (await file.json()) as Registry;
}

export async function saveRegistry(
  registry: Registry,
  registryPath = DEFAULT_REGISTRY_PATH,
): Promise<void> {
  await Bun.write(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

/** Normalize a path to be repo-root-relative so registry entries are stable. */
export function normalizePath(path: string, root = process.cwd()): string {
  return relative(root, resolve(root, path));
}

export interface RegisterInput {
  path: string;
  url: string;
  license: string;
  note?: string;
}

/**
 * Register a source file (or refresh its entry if the path is already known).
 * Returns the entry that was written.
 */
export async function registerFile(
  input: RegisterInput,
  registryPath = DEFAULT_REGISTRY_PATH,
): Promise<RegistryEntry> {
  const path = normalizePath(input.path);
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Cannot register missing file: ${path}`);
  }
  const entry: RegistryEntry = {
    path,
    sha256: await sha256File(path),
    url: input.url,
    downloadedAt: new Date().toISOString(),
    license: input.license,
    ...(input.note ? { note: input.note } : {}),
  };
  const registry = await loadRegistry(registryPath);
  const existing = registry.files.findIndex((f) => f.path === path);
  if (existing >= 0) registry.files[existing] = entry;
  else registry.files.push(entry);
  await saveRegistry(registry, registryPath);
  return entry;
}

/**
 * Gate for the pipeline (VOY-DOC-08): returns the entry for `path`, throwing
 * if the file was never registered or has been modified since registration.
 */
export async function requireRegistered(
  path: string,
  registryPath = DEFAULT_REGISTRY_PATH,
): Promise<RegistryEntry> {
  const normalized = normalizePath(path);
  const registry = await loadRegistry(registryPath);
  const entry = registry.files.find((f) => f.path === normalized);
  if (!entry) {
    throw new Error(
      `VOY-DOC-08: "${normalized}" is not in ${registryPath}. ` +
        `Register it first: bun run register ${normalized} --url <origin> --license <terms>`,
    );
  }
  const actual = await sha256File(normalized);
  if (actual !== entry.sha256) {
    throw new Error(
      `VOY-DOC-08: "${normalized}" content does not match its registered SHA-256 ` +
        `(expected ${entry.sha256}, got ${actual}). Re-register it if the change is intentional.`,
    );
  }
  return entry;
}
