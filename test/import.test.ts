/**
 * Tests voor het lezen van een streams-setup uit de URL.
 *   node test/import.test.ts
 */
import { parseImportSearch } from '../src/import.ts';

interface TestResult {
  name: string;
  ok: boolean;
  message?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function equal(actual: string[], expected: string[], message: string): void {
  assert(
    actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    `${message} (verwacht ${JSON.stringify(expected)}, kreeg ${JSON.stringify(actual)})`,
  );
}

test('kale query met plusjes', () => {
  equal(
    parseImportSearch('?noanoella+altijdmelvin+ljoeb'),
    ['noanoella', 'altijdmelvin', 'ljoeb'],
    'kanalen',
  );
});

test('streams-parameter met plusjes', () => {
  equal(
    parseImportSearch('?streams=noanoella+altijdmelvin+ljoeb'),
    ['noanoella', 'altijdmelvin', 'ljoeb'],
    'kanalen',
  );
});

test('meerdere add-parameters', () => {
  equal(
    parseImportSearch('?add=shroud&add=https%3A%2F%2Ftwitch.tv%2Fkaicenat'),
    ['shroud', 'https://twitch.tv/kaicenat'],
    'bronnen',
  );
});

test('komma en puntkomma als scheiding', () => {
  equal(parseImportSearch('?a,b;c'), ['a', 'b', 'c'], 'kanalen');
});

test('procent-codering', () => {
  equal(parseImportSearch('?noanoella%20altijdmelvin'), ['noanoella', 'altijdmelvin'], 'kanalen');
});

test('lege query', () => {
  equal(parseImportSearch(''), [], 'geen bronnen');
});

test('reset is geen stream', () => {
  equal(parseImportSearch('?reset'), [], 'geen bronnen');
});

test('gewone queryparameters negeren', () => {
  equal(parseImportSearch('?utm_source=test'), [], 'geen bronnen');
});

let passed = 0;
for (const result of results) {
  if (result.ok) {
    passed++;
  } else {
    console.error(`  ✗ ${result.name}: ${result.message}`);
  }
}
console.log(`${passed}/${results.length} import-tests geslaagd`);
if (passed !== results.length) process.exitCode = 1;
