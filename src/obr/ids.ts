// Reverse-DNS namespace confirmed with the user. Prefixes every OBR room/player
// metadata key and broadcast channel this extension uses.
export const NAMESPACE = 'com.jackvcurtis.action-dice';

// e.g. getPluginId('locks') → 'com.jackvcurtis.action-dice/locks'.
export function getPluginId(path: string): string {
  return `${NAMESPACE}/${path}`;
}
