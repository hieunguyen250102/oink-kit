/**
 * The room-code box, made to survive a Vietnamese keyboard.
 *
 * With Telex on (Unikey, EVKey, ibus, Laban Key, Gboard…) a lone "w" turns
 * into "ư", "aa" into "â", "dd" into "đ", and s/f/r/x/j put a tone on the
 * vowel before them. A box that simply drops non-ASCII then loses the key:
 * typing W did nothing at all. Room codes use A–Z and 2–9, so every one of
 * those rewrites can hit a code.
 *
 * This turns the rewrite back into the keys that were pressed. Feed it the
 * raw input value and what the box showed before:
 *
 *   onChange={(e) => setCode(roomCodeInput(e.target.value, code, 4, e.target.selectionStart))}
 */

/** combining mark → the Telex key that adds it ('' = press the letter again) */
const MARK_KEYS: Record<string, string> = {
  '̂': '', // â ê ô: aa ee oo
  '̆': 'W', // ă: aw
  '̛': 'W', // ơ ư: ow uw (or a lone w)
  '́': 'S', // sắc
  '̀': 'F', // huyền
  '̉': 'R', // hỏi
  '̃': 'X', // ngã
  '̣': 'J', // nặng
};

interface Keys {
  /** the plain letter */
  base: string;
  /** what was pressed on top of it, in Telex order (shape, then tone) */
  extra: string;
}

function telexKeys(ch: string): Keys {
  if (ch === 'Đ') return { base: 'D', extra: 'D' };
  const [base, ...marks] = ch.normalize('NFD');
  let extra = '';
  for (const m of marks) {
    const key = MARK_KEYS[m];
    if (key === undefined) continue;
    extra += key === '' ? base : key;
  }
  // shape before tone, as typed: "ắ" is a, w, s
  return { base, extra: [...extra].sort((a, b) => toneLast(a) - toneLast(b)).join('') };
}

const toneLast = (k: string) => ('SFRXJ'.includes(k) ? 1 : 0);

function letters(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

/**
 * The key that turned `removed` into `inserted`, when exactly one did —
 * "AN" → "ÁN" is S, "U" → "Ư" is W, "A" → "Â" is A. Null otherwise.
 */
function singleKey(removed: string, inserted: Keys[]): string | null {
  const pressed = letters(inserted.map((k) => k.base + k.extra).join(''));
  for (const [ch, n] of letters(removed)) {
    const left = (pressed.get(ch) ?? 0) - n;
    if (left < 0) return null;
    if (left === 0) pressed.delete(ch);
    else pressed.set(ch, left);
  }
  const rest = [...pressed.entries()];
  return rest.length === 1 && rest[0][1] === 1 ? rest[0][0] : null;
}

function spell(k: Keys): string {
  // "ư" out of nowhere is a lone w — the U was never typed
  if (k.base === 'U' && k.extra.startsWith('W')) return k.extra;
  return k.base + k.extra;
}

/**
 * Upper-case, A–Z/0–9 only, at most `length` characters — with any Telex
 * rewrite undone (see the top of this file). `caret` is the input's
 * selectionStart after the change; it says where the key was pressed when a
 * tone lands on an earlier letter ("an" + s → "án" means a, n, s).
 */
export function roomCodeInput(raw: string, prev = '', length = 4, caret?: number | null): string {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/g, '').slice(0, length);
  const now = raw.toUpperCase();
  if (!/[^\x00-\x7F]/.test(now)) return clean(now);

  // What the keyboard replaced: the part between what is unchanged at both ends.
  const before = prev.toUpperCase();
  let head = 0;
  while (head < before.length && head < now.length && before[head] === now[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < now.length - head &&
    before[before.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail++;
  }
  const removed = before.slice(head, before.length - tail);
  const inserted = [...now.slice(head, now.length - tail)].map(telexKeys);

  // One key rewrote letters that were already there: keep them, and put the
  // key where it was typed — at the caret, which is after the rewritten part.
  const key = singleKey(removed, inserted);
  if (key !== null) {
    const tailStart = now.length - tail;
    const at = head + removed.length + Math.max(0, Math.min(tail, (caret ?? now.length) - tailStart));
    return clean(before.slice(0, at) + key + before.slice(at));
  }
  return clean(now.slice(0, head) + inserted.map(spell).join('') + now.slice(now.length - tail));
}
