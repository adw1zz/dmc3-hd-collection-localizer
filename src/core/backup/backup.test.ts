import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256File } from '../fs/index.js';
import { Backup, loadManifest, ManifestError } from './index.js';

let tmp: string;
let target: string;
let backupDir: string;

async function put(root: string, rel: string, content: string): Promise<string> {
  const full = path.join(root, ...rel.split('/'));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dmc3-backup-'));
  target = path.join(tmp, 'target');
  backupDir = path.join(tmp, 'backup');
  await mkdir(target);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const open = (): Promise<Backup> => Backup.open({ backupDir, targetDir: target, tool: 'test' });

describe('Backup', () => {
  it('refuses a backup dir inside the target and a manifest of another target', async () => {
    await expect(
      Backup.open({ backupDir: path.join(target, 'b'), targetDir: target, tool: 't' }),
    ).rejects.toBeInstanceOf(ManifestError);

    const b = await open();
    await b.save();
    await expect(
      Backup.open({ backupDir, targetDir: path.join(tmp, 'other'), tool: 't' }),
    ).rejects.toThrow(/different target/);
  });

  it('backs up new files once, then recognises original / already-localized / changed', async () => {
    const file = await put(target, 'Video/a.webm', 'ORIGINAL');
    const b = await open();
    expect(b.isNew).toBe(true);
    expect(await b.classify('Video/a.webm')).toEqual({ state: 'new' });

    expect(await b.backup('Video/a.webm')).toBe('new');
    expect(await readFile(b.copyPath('Video/a.webm'), 'utf8')).toBe('ORIGINAL');
    await b.save();

    // same file, nothing changed
    const b2 = await open();
    expect(b2.isNew).toBe(false);
    expect((await b2.classify('Video/a.webm')).state).toBe('original');
    expect(await b2.backup('Video/a.webm')).toBe('original');

    // we "apply": write a result and record its hash
    await writeFile(file, 'LOCALIZED');
    b2.recordResult('Video/a.webm', await sha256File(file), 'mov/a.mpg');
    await b2.save();

    const b3 = await open();
    expect((await b3.classify('Video/a.webm')).state).toBe('already-localized');
    expect(await readFile(b3.copyPath('Video/a.webm'), 'utf8')).toBe('ORIGINAL'); // untouched

    // Steam verify put a new original in place
    await writeFile(file, 'NEW-ORIGINAL');
    const b4 = await open();
    expect((await b4.classify('Video/a.webm')).state).toBe('changed');
    expect(await b4.backup('Video/a.webm')).toBe('changed');
    expect(await readFile(b4.copyPath('Video/a.webm'), 'utf8')).toBe('NEW-ORIGINAL');
    expect(b4.entry('Video/a.webm')?.result).toBeUndefined();
  });

  it('restore puts originals back, skips missing and corrupt copies', async () => {
    const a = await put(target, 'Video/a.webm', 'A');
    const c = await put(target, 'afs/sound/c.ogg', 'C');
    await put(target, 'afs/sound/d.ogg', 'D');
    const b = await open();
    for (const rel of ['Video/a.webm', 'afs/sound/c.ogg', 'afs/sound/d.ogg']) await b.backup(rel);
    await writeFile(a, 'A-LOC');
    await writeFile(c, 'C-LOC');
    b.recordResult('Video/a.webm', await sha256File(a), 's');
    await b.save();

    await writeFile(b.copyPath('afs/sound/c.ogg'), 'TAMPERED');
    await rm(b.copyPath('afs/sound/d.ogg'));

    const r = await (await open()).restore();
    expect(r).toEqual({
      restored: ['Video/a.webm'],
      corrupt: ['afs/sound/c.ogg'],
      missing: ['afs/sound/d.ogg'],
    });
    expect(await readFile(a, 'utf8')).toBe('A');
    expect(await readFile(c, 'utf8')).toBe('C-LOC');
  });

  it('writes a sorted, versioned manifest', async () => {
    await put(target, 'b.ogg', '1');
    await put(target, 'a.ogg', '2');
    const b = await open();
    await b.backup('b.ogg');
    await b.backup('a.ogg');
    await b.save();
    const m = await loadManifest(backupDir);
    expect(m?.version).toBe(1);
    expect(Object.keys(m?.entries ?? {})).toEqual(['a.ogg', 'b.ogg']);
    expect(m?.targetDir).toBe(target);
  });
});
