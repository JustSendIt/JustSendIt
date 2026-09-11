/* Where things are, derived from where this file is — never from an absolute path typed into a suite.
   The suites used to hard-code /Users/<somebody>/Desktop/JustSendIt, which meant they ran on exactly one
   machine and could not be checked out, shared, or run in CI. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_JS = path.join(ROOT, 'server.js');
export const ETHERS = path.join(ROOT, 'node_modules', 'ethers', 'lib.commonjs', 'index.js');

/* WHICH DATABASE. Defaults to data/app.db so a suite run by hand behaves as it always has — but
   `npm test` sets JSI_DATA_DIR to a throwaway directory and starts a server against it, so the full run
   never touches real data at all. Every suite creates and deletes its own rows either way; this is the
   belt to that pair of braces. */
export const DATA_DIR = process.env.JSI_DATA_DIR || path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const KEY_PATH = path.join(DATA_DIR, '.data_key');
