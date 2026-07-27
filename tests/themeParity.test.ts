import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../src/collector/settings';
import { APP_THEMES, DEFAULT_THEME } from '../src/renderer/src/themes';

/**
 * Four places enumerate the theme set: the renderer registry, the main-process
 * validator, the pre-paint boot script and the token stylesheet. Nothing else
 * ties them together, and a theme missing from any one of them fails in a way
 * that looks like a styling bug rather than a missing entry.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('theme registry parity', () => {
  const ids = APP_THEMES.map((theme) => theme.id);

  it('agrees with the main-process validator', () => {
    expect([...THEME_IDS]).toEqual(ids);
  });

  it('agrees with the pre-paint boot script', () => {
    const boot = read('src/renderer/public/theme-boot.js');
    const listed = boot.match(/VALID\s*=\s*\[([^\]]+)\]/)?.[1] ?? '';
    const parsed = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(parsed).toEqual(ids);
  });

  it('defines tokens for every theme and nothing else', () => {
    const css = read('src/renderer/src/themes.css');
    const blocks = [...css.matchAll(/html\[data-theme='([^']+)'\]/g)].map((match) => match[1]);

    // The default is served by :root as well as its own selector, so it must
    // appear; every other id needs exactly one block.
    expect(new Set(blocks)).toEqual(new Set(ids));
    expect(css).toContain(`html[data-theme='${DEFAULT_THEME}']`);
  });

  it('gives every theme a full token set', () => {
    const css = read('src/renderer/src/themes.css');
    const tokensIn = (selector: string): Set<string> => {
      const start = css.indexOf(selector);
      const block = css.slice(start, css.indexOf('}', start));
      return new Set([...block.matchAll(/(--rc-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
    };

    const baseline = tokensIn(`html[data-theme='${DEFAULT_THEME}']`);
    expect(baseline.size).toBeGreaterThan(10);

    for (const id of ids) {
      // A theme missing one token silently inherits the default's colour, which
      // is how a light theme ends up with one unreadable dark panel.
      expect(tokensIn(`html[data-theme='${id}']`), `theme ${id}`).toEqual(baseline);
    }
  });

  it('uses each theme accent as its own swatch', () => {
    const css = read('src/renderer/src/themes.css');
    for (const theme of APP_THEMES) {
      const start = css.indexOf(`html[data-theme='${theme.id}']`);
      const block = css.slice(start, css.indexOf('}', start));
      const accent = block.match(/--rc-accent:\s*([^;]+);/)?.[1]?.trim();
      expect(accent, `theme ${theme.id}`).toBe(theme.dot);
    }
  });
});
