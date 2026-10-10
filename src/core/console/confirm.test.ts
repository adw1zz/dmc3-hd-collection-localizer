import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { confirm, parseYesNo } from './confirm.js';

function ask(answers: string[], defaultAnswer?: boolean): Promise<boolean> {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const p = confirm('Continue?', {
    input,
    output,
    ...(defaultAnswer === undefined ? {} : { defaultAnswer }),
  });
  input.end(answers.map((a) => `${a}\n`).join(''));
  return p;
}

describe('parseYesNo', () => {
  it('accepts latin and cyrillic answers, any case', () => {
    expect(parseYesNo('Y')).toBe(true);
    expect(parseYesNo(' yes ')).toBe(true);
    expect(parseYesNo('Да')).toBe(true);
    expect(parseYesNo('n')).toBe(false);
    expect(parseYesNo('НЕТ')).toBe(false);
    expect(parseYesNo('maybe')).toBeUndefined();
    expect(parseYesNo('')).toBeUndefined();
  });
});

describe('confirm', () => {
  it('returns true for y', async () => {
    expect(await ask(['y'])).toBe(true);
  });
  it('returns false for n', async () => {
    expect(await ask(['n'])).toBe(false);
  });
  it('re-asks on garbage, then accepts', async () => {
    expect(await ask(['what', 'yes'])).toBe(true);
  });
  it('uses the default on empty input', async () => {
    expect(await ask([''])).toBe(false);
    expect(await ask([''], true)).toBe(true);
  });
});
