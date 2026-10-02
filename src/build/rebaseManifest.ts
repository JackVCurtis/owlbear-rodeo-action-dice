// Build-time only. OBR resolves root-relative manifest paths (e.g. "/icon.svg")
// against the manifest's origin, so when the app is served under a subpath (a
// GitHub Pages project site) every root-relative path must carry that base.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function rebasePath(path: string, base: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return base.replace(/\/$/, '') + path;
}

// Prefixes `base` onto every root-relative string value in the manifest. Absolute
// URLs and plain strings (name, description, …) are left untouched.
export function rebaseManifest<T extends Json>(manifest: T, base: string): T {
  const walk = (value: Json): Json => {
    if (typeof value === 'string') return rebasePath(value, base);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(manifest) as T;
}
