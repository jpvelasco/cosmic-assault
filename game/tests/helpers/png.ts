import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

/** The file at `path`, checked to be a PNG, with the width and height from its IHDR chunk (which follows the 8-byte signature). */
export function readPng(path: string | URL, hint = ''): { bytes: Buffer; width: number; height: number } {
  const bytes = readFileSync(path);
  const name = String(path);
  expect(bytes.subarray(0, 8).toString('hex'), `${name} is not a PNG${hint}`).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('ascii'), `${name} has no IHDR chunk${hint}`).toBe('IHDR');
  return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
