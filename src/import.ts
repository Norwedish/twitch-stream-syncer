import { parseSource, type ParsedSource } from './sources';

export interface ParseResult {
  sources: ParsedSource[];
  errors: string[];
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
