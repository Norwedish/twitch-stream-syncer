import { parseSource, type ParsedSource } from './sources.ts';

export interface ParseResult {
  sources: ParsedSource[];
  errors: string[];
}

function splitTokens(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function decodeQuery(raw: string): string {
  // In een query betekent "+" een spatie; %2B is een echte plus.
  const spaced = raw.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/**
 * Leest een setup uit de URL.
 *
 * Ondersteund:
 *   /addstreams?shroud+kaicenat
 *   /addstreams?streams=shroud+kaicenat
 *   /?add=shroud&add=https://twitch.tv/kaicenat
 *
 * Geeft de losse bronnen terug (kanalen of URLs); de aanroeper voegt ze toe.
 */
export function parseImportSearch(search: string): string[] {
  const raw = search.replace(/^\?/, '');
  if (!raw) return [];

  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  // `?reset` is een commando, geen streamnaam.
  if (params.has('reset')) return [];

  const named = ['add', 'streams'].flatMap((key) => params.getAll(key)).flatMap(splitTokens);
  if (named.length > 0) return named;
  if (params.has('add') || params.has('streams')) return [];

  // Kale query: ?shroud+kaicenat of ?shroud,kaicenat.
  // Een query met "=" is een gewone parameter (utm_source, enz.), geen setup.
  if (raw.includes('=')) return [];
  return splitTokens(decodeQuery(raw));
}

/**
 * Leest een lijst met URLs of channelnamen (één per regel, of gescheiden door
 * komma's/spaties). Regels die beginnen met `#` worden genegeerd.
 */
export function parseSourceList(input: string): ParseResult {
  const sources: ParsedSource[] = [];
  const errors: string[] = [];
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('#'));

  for (const token of tokens) {
    const parsed = parseSource(token);
    if (parsed) sources.push(parsed);
    else errors.push(token);
  }
  return { sources, errors };
}
