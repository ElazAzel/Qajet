/** Allow only an internal path in Auth callback redirects. */
export function safeAuthPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  // URL parsers normalize backslashes and strip tabs/newlines. A path such as
  // /\\host or /\n/host can therefore become an off-origin redirect.
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '\\' || code <= 0x1f || code === 0x7f) return fallback;
  }
  return value;
}
