/**
 * Controleert dat alle talen dezelfde teksten hebben.
 *   node test/i18n.test.ts
 */
import { LANGS, MESSAGES, LANG_NAMES } from '../src/i18n.ts';

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

const reference = MESSAGES.nl;
const referenceKeys = Object.keys(reference).sort();

test('elke taal heeft alle teksten', () => {
  for (const lang of LANGS) {
    const keys = Object.keys(MESSAGES[lang]).sort();
    const missing = referenceKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !referenceKeys.includes(k));
    assert(missing.length === 0, `${lang} mist: ${missing.join(', ')}`);
    assert(extra.length === 0, `${lang} heeft onbekende sleutels: ${extra.join(', ')}`);
  }
});

test('teksten hebben hetzelfde type als in het Nederlands', () => {
  for (const lang of LANGS) {
    for (const key of referenceKeys) {
      const expected = typeof reference[key as keyof typeof reference];
      const actual = typeof MESSAGES[lang][key as keyof typeof reference];
      assert(actual === expected, `${lang}.${key}: ${actual} i.p.v. ${expected}`);
    }
  }
});

test('geen lege of ontbrekende teksten', () => {
  for (const lang of LANGS) {
    for (const key of referenceKeys) {
      const value = MESSAGES[lang][key as keyof typeof reference];
      if (typeof value === 'string') {
        assert(value.trim().length > 0, `${lang}.${key} is leeg`);
      }
    }
  }
});

test('functies geven tekst terug', () => {
  for (const lang of LANGS) {
    const m = MESSAGES[lang];
    assert(m.statusReference('kanaal', true).includes('kanaal'), `${lang}: statusReference`);
    assert(m.addedToast(2, 1, 0).length > 0, `${lang}: addedToast`);
    assert(m.statusPending('x', '3s').includes('x'), `${lang}: statusPending`);
    assert(m.openTwitch('shroud').includes('shroud'), `${lang}: openTwitch`);
    assert(m.languageChanged(LANG_NAMES[lang]).includes(LANG_NAMES[lang]), `${lang}: languageChanged`);
  }
});

test('elke taal heeft een eigen naam', () => {
  const names = LANGS.map((l) => LANG_NAMES[l]);
  assert(new Set(names).size === names.length, 'dubbele taalnamen');
  for (const name of names) assert(name.trim().length > 0, 'lege taalnaam');
});

let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`  ok   ${result.name}`);
  } else {
    failed++;
    console.log(`  FAIL ${result.name}\n       ${result.message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} tests geslaagd (${LANGS.length} talen)`);
if (failed > 0) process.exit(1);
