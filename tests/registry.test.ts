import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  loadRegistry,
  registerFile,
  requireRegistered,
  sha256File,
} from "../src/ingest/registry.ts";

describe("registry (VOY-DOC-08)", () => {
  let dir: string;
  let registryPath: string;
  let sourcePath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "voynich-registry-"));
    registryPath = join(dir, "registry.json");
    // registerFile normalizes to cwd-relative paths, so keep the fixture under cwd-resolvable form
    sourcePath = relative(process.cwd(), join(dir, "sample.txt"));
    await Bun.write(sourcePath, "fachys ykal ar ataiin\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("sha256File matches a known digest", async () => {
    await Bun.write(sourcePath, "abc");
    expect(await sha256File(sourcePath)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("registerFile writes an entry and requireRegistered accepts it", async () => {
    const entry = await registerFile(
      { path: sourcePath, url: "http://example.org/sample", license: "research-only" },
      registryPath,
    );
    expect(entry.sha256).toHaveLength(64);

    const registry = await loadRegistry(registryPath);
    expect(registry.files).toHaveLength(1);

    const gate = await requireRegistered(sourcePath, registryPath);
    expect(gate.url).toBe("http://example.org/sample");
  });

  test("registering the same path twice updates instead of duplicating", async () => {
    const input = { path: sourcePath, url: "http://a", license: "x" };
    await registerFile(input, registryPath);
    await registerFile({ ...input, url: "http://b" }, registryPath);
    const registry = await loadRegistry(registryPath);
    expect(registry.files).toHaveLength(1);
    expect(registry.files[0]?.url).toBe("http://b");
  });

  test("requireRegistered rejects an unregistered file", async () => {
    expect(requireRegistered(sourcePath, registryPath)).rejects.toThrow("VOY-DOC-08");
  });

  test("requireRegistered rejects a file modified after registration", async () => {
    await registerFile({ path: sourcePath, url: "http://a", license: "x" }, registryPath);
    await Bun.write(sourcePath, "tampered content\n");
    expect(requireRegistered(sourcePath, registryPath)).rejects.toThrow("SHA-256");
  });

  test("registerFile refuses a missing file", async () => {
    expect(
      registerFile({ path: join(dir, "nope.txt"), url: "http://a", license: "x" }, registryPath),
    ).rejects.toThrow("missing");
  });
});
