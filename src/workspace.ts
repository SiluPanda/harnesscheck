import { createHash } from "node:crypto";
import { cp, lstat, mkdir, opendir, readFile, readlink, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { ConfigError, HarnessCheckError } from "./errors.js";
import { runProcess } from "./process.js";
import type { FileChange, FileFingerprint } from "./types.js";

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isIgnored(relativePath: string, patterns: string[], directory: boolean): boolean {
  const candidate = toPosix(relativePath);
  return patterns.some((pattern) =>
    minimatch(candidate, pattern, { dot: true, partial: directory, nocase: false }),
  );
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveInside(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new HarnessCheckError(`Assertion paths must be relative: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolved);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new HarnessCheckError(`Path escapes the trial workspace: ${relativePath}`);
  }
  return resolved;
}

export async function assertNoSymlinkTraversal(
  root: string,
  relativePath: string,
): Promise<string> {
  const resolved = resolveInside(root, relativePath);
  const resolvedRoot = path.resolve(root);
  const relation = path.relative(resolvedRoot, resolved);
  const parts = relation.split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new HarnessCheckError(
          `Refusing to follow a symlink in assertion path: ${relativePath}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return resolved;
}

export async function readWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const resolved = await assertNoSymlinkTraversal(root, relativePath);
  const stats = await lstat(resolved);
  if (!stats.isFile()) throw new HarnessCheckError(`Not a regular file: ${relativePath}`);
  if (stats.size > 10_000_000) {
    throw new HarnessCheckError(`File is too large to inspect (>10 MB): ${relativePath}`);
  }
  return await readFile(resolved, "utf8");
}

export async function copyFixture(
  fixturePath: string,
  workspacePath: string,
  excludePatterns: string[],
): Promise<void> {
  let canonicalFixture: string;
  try {
    canonicalFixture = await realpath(fixturePath);
    const stats = await lstat(canonicalFixture);
    if (!stats.isDirectory()) throw new ConfigError(`Fixture is not a directory: ${fixturePath}`);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Fixture directory does not exist: ${fixturePath}`, { cause: error });
  }

  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await cp(canonicalFixture, workspacePath, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    filter: async (source) => {
      const relation = path.relative(canonicalFixture, source);
      if (relation === "") return true;
      if (isIgnored(relation, excludePatterns, false)) return false;
      const stats = await lstat(source);
      if (stats.isSymbolicLink()) {
        throw new ConfigError(
          `Fixture contains a symbolic link, which HarnessCheck refuses to copy: ${toPosix(relation)}`,
        );
      }
      return !isIgnored(relation, excludePatterns, stats.isDirectory());
    },
  });
}

export async function initializeGitWorkspace(workspacePath: string): Promise<void> {
  const common = {
    cwd: workspacePath,
    timeoutMs: 30_000,
    maxOutputBytes: 100_000,
  };
  const init = await runProcess({ ...common, command: "git", args: ["init", "--quiet"] });
  if (init.exitCode !== 0) return;
  const add = await runProcess({ ...common, command: "git", args: ["add", "--all"] });
  if (add.exitCode !== 0) return;
  await runProcess({
    ...common,
    command: "git",
    args: [
      "-c",
      "user.name=HarnessCheck",
      "-c",
      "user.email=harnesscheck@localhost",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "HarnessCheck baseline",
    ],
  });
}

async function fingerprintFile(root: string, absolutePath: string): Promise<FileFingerprint> {
  const stats = await lstat(absolutePath);
  const relative = toPosix(path.relative(root, absolutePath));
  if (stats.isSymbolicLink()) {
    const target = await readlink(absolutePath);
    return {
      path: relative,
      kind: "symlink",
      hash: createHash("sha256").update(target).digest("hex"),
      size: Buffer.byteLength(target),
      mode: stats.mode & 0o777,
    };
  }
  const content = await readFile(absolutePath);
  return {
    path: relative,
    kind: "file",
    hash: createHash("sha256").update(content).digest("hex"),
    size: stats.size,
    mode: stats.mode & 0o777,
  };
}

export async function snapshotWorkspace(
  root: string,
  excludePatterns: string[],
): Promise<Map<string, FileFingerprint>> {
  const snapshot = new Map<string, FileFingerprint>();

  const visit = async (directory: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolutePath = path.join(directory, entry.name);
      const relative = path.relative(root, absolutePath);
      if (isIgnored(relative, excludePatterns, entry.isDirectory())) continue;
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        const fingerprint = await fingerprintFile(root, absolutePath);
        snapshot.set(fingerprint.path, fingerprint);
      }
    }
  };

  await visit(root);
  return snapshot;
}

export function diffSnapshots(
  before: Map<string, FileFingerprint>,
  after: Map<string, FileFingerprint>,
): FileChange[] {
  const changes: FileChange[] = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const filePath of [...paths].sort()) {
    const previous = before.get(filePath);
    const current = after.get(filePath);
    if (previous === undefined) changes.push({ path: filePath, status: "created" });
    else if (current === undefined) changes.push({ path: filePath, status: "deleted" });
    else if (
      previous.hash !== current.hash ||
      previous.kind !== current.kind ||
      previous.mode !== current.mode
    ) {
      changes.push({ path: filePath, status: "modified" });
    }
  }
  return changes;
}
