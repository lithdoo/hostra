import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createFVWsConnection } from '../src/connection.js';

test('changeTargetDir/getState/clearTargetDir works', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fv-conn-'));
  try {
    await writeFile(join(root, 'alpha.txt'), 'hello');
    const conn = createFVWsConnection();
    const state = await conn.changeTargetDir(pathToFileURL(root).toString());

    assert.ok(state.targetDir);
    assert.equal(state.targetDir.kind, 'directory');
    assert.ok(state.fileList.some((item) => item.name === 'alpha.txt' && item.kind === 'file'));

    const current = await conn.getState();
    assert.ok(current.fileList.length >= 1);

    const cleared = await conn.clearTargetDir();
    assert.equal(cleared.fileList.length, 0);
    assert.equal(cleared.targetDir, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('meta/thumb attachments follow primary entries only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fv-attach-'));
  try {
    await writeFile(join(root, 'orphan.meta.toml'), 'title = "orphan"');
    await writeFile(join(root, 'orphan.thumb.jpg'), 'x');

    await writeFile(join(root, 'movie.mp4'), 'content');
    await writeFile(
      join(root, 'movie.mp4.meta.toml'),
      ['[info]', 'title = "movie"', 'describe = "demo file"', 'tags = ["video", "demo"]', '', '[extends]', 'rating = 5'].join('\n'),
    );
    await writeFile(join(root, 'movie.mp4.thumb.png'), 'thumb');

    await mkdir(join(root, 'album'));
    await writeFile(join(root, 'album.meta.toml'), ['[info]', 'title = "album"'].join('\n'));
    await writeFile(join(root, 'album.thumb.webp'), 'thumb');
    await writeFile(join(root, 'album.thumb.jpg'), 'thumb');
    await mkdir(join(root, 'albumUpper'));
    await writeFile(join(root, 'albumUpper.thumb.JPG'), 'thumb');

    const conn = createFVWsConnection();
    await conn.changeTargetDir(pathToFileURL(root).toString());
    const state = await conn.getState();

    assert.equal(state.fileList.some((item) => item.name === 'orphan.meta.toml'), false);
    assert.equal(state.fileList.some((item) => item.name === 'orphan.thumb.jpg'), false);

    const movie = state.fileList.find((item) => item.kind === 'file' && item.name === 'movie.mp4');
    assert.ok(movie);
    assert.ok(movie.metadataFileUrl?.endsWith('/movie.mp4.meta.toml'));
    assert.ok(movie.thumbnailFileUrl?.endsWith('/movie.mp4.thumb.png'));
    assert.equal(movie.metadata?.info?.title, 'movie');
    assert.equal(movie.metadata?.info?.describe, 'demo file');
    assert.deepEqual(movie.metadata?.info?.tags, ['video', 'demo']);
    assert.equal(movie.metadata?.extends?.rating, 5);

    const album = state.fileList.find((item) => item.kind === 'directory' && item.name === 'album');
    assert.ok(album);
    assert.ok(album.metadataFileUrl?.endsWith('/album.meta.toml'));
    assert.ok(typeof album.thumbnailFileUrl === 'string');
    assert.ok(album.thumbnailFileUrl.includes('album.thumb.jpg'));
    assert.equal(album.thumbnailFileUrl.includes('album.thumb.webp'), false);
    assert.equal(album.thumbnailFileUrl.includes('album.thumb.JPG'), false);
    assert.equal(album.metadata?.info?.title, 'album');

    const albumUpper = state.fileList.find((item) => item.kind === 'directory' && item.name === 'albumUpper');
    assert.ok(albumUpper);
    assert.equal(albumUpper.thumbnailFileUrl, undefined);

    await conn.clearTargetDir();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid meta toml does not break scan and returns undefined metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fv-invalid-meta-'));
  try {
    await writeFile(join(root, 'bad.txt'), 'content');
    await writeFile(join(root, 'bad.txt.meta.toml'), '[info\ntitle = "broken"');
    const conn = createFVWsConnection();
    await conn.changeTargetDir(pathToFileURL(root).toString());
    const state = await conn.getState();
    const badFile = state.fileList.find((item) => item.kind === 'file' && item.name === 'bad.txt');
    assert.ok(badFile);
    assert.ok(badFile.metadataFileUrl?.endsWith('/bad.txt.meta.toml'));
    assert.equal(badFile.metadata, undefined);
    await conn.clearTargetDir();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
