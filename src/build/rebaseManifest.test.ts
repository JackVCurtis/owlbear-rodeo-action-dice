import { describe, expect, it } from 'vitest';
import { rebaseManifest } from './rebaseManifest';

const manifest = {
  name: 'Action Dice Combat',
  icon: '/icon.svg',
  homepage_url: 'https://example.com/',
  action: { title: 'Action Dice Combat', icon: '/icon.svg', popover: '/', height: 700 },
};

describe('rebaseManifest', () => {
  it('prefixes the base onto root-relative paths', () => {
    const out = rebaseManifest(manifest, '/owlbear-rodeo-action-dice/');
    expect(out.icon).toBe('/owlbear-rodeo-action-dice/icon.svg');
    expect(out.action.icon).toBe('/owlbear-rodeo-action-dice/icon.svg');
    expect(out.action.popover).toBe('/owlbear-rodeo-action-dice/');
  });

  it('leaves absolute URLs, plain strings and numbers untouched', () => {
    const out = rebaseManifest(manifest, '/repo/');
    expect(out.name).toBe('Action Dice Combat');
    expect(out.homepage_url).toBe('https://example.com/');
    expect(out.action.height).toBe(700);
  });

  it('is a no-op for the root base', () => {
    expect(rebaseManifest(manifest, '/')).toEqual(manifest);
  });
});
