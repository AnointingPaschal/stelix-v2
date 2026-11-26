/**
 * Regression test for Workstream B requirement 1: no placeholder /
 * sample-data references anywhere under src/. The forbidden word is
 * built by concatenation so this test file itself does not contain it.
 * Run: npm test
 */
import * as fs from 'fs';
import * as path from 'path';

const FORBIDDEN = 'dem' + 'o'; // the word this suite guards against
const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no placeholder references in src', () => {
  it(`no source file contains "${FORBIDDEN}" (case-insensitive)`, () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      if (new RegExp(FORBIDDEN, 'i').test(text)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
