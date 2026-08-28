// tests/native/renameFailureCopy.test.tsx — every way a rename can be refused
// reaches the player as a different sentence.
//
// `tests/renameCopy.test.ts` proves the catalogue holds different strings.
// This proves the code path picks the right one, which is a separate claim: a
// `serverErrorMessage` that fell through to its fallback would leave that test
// green and tell the player "try again" for all four refusals. Copy that
// distinguishes nothing looks exactly like copy that works.
//
// Here rather than in the node tier because `serverErrorMessage` reaches
// `lib/i18n`, which needs expo-localization and AsyncStorage; and no component
// is rendered, because the screen's own control cannot be driven twice in one
// file (#523).
import { describe, it, expect } from '@jest/globals';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';
import { ApiError, serverErrorMessage } from '@/lib/apiError';
import { USERNAME_MAX, USERNAME_MIN, usernameProblem } from '@/shared/username';

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

const FALLBACK = t('profile.renameFailed');

/** What the screen shows for a request the server refused with `code`. */
const refusal = (status: number, code: string) =>
  serverErrorMessage(new ApiError(status, { code, message: '' }, '{}'), FALLBACK);

/** …and what it shows for a name the device rejected before spending one. */
function localRefusal(name: string): string {
  const problem = usernameProblem(name);
  if (!problem) throw new Error(`${name} is a valid username`);
  const key = {
    tooShort: 'profile.renameTooShort',
    tooLong: 'profile.renameTooLong',
    invalidChars: 'profile.renameInvalidChars',
  }[problem];
  return t(key, { min: USERNAME_MIN, max: USERNAME_MAX });
}

describe('a refused rename says which refusal it was', () => {
  it('keeps the server`s own reason for a name that is taken', () => {
    expect(refusal(409, 'USERNAME_TAKEN')).toBe(t('server.USERNAME_TAKEN'));
  });

  it('keeps it again when the rename budget is spent', () => {
    expect(refusal(429, 'RENAME_RATE_LIMITED')).toBe(t('server.RENAME_RATE_LIMITED'));
  });

  it('falls back only when the failure was not the server answering', () => {
    expect(serverErrorMessage(new TypeError('Network request failed'), FALLBACK)).toBe(FALLBACK);
    // A refusal the server sent but this build has no key for still shows what
    // it said, rather than borrowing the dropped-connection sentence.
    expect(refusal(418, 'SOMETHING_NEW')).not.toBe(FALLBACK);
  });

  it('names which rule a bad name broke', () => {
    expect(localRefusal('ab')).toBe(t('profile.renameTooShort', { min: USERNAME_MIN }));
    expect(localRefusal('ana besi')).toBe(t('profile.renameInvalidChars'));
    expect(localRefusal('a'.repeat(USERNAME_MAX + 1))).toBe(
      t('profile.renameTooLong', { max: USERNAME_MAX })
    );
  });

  // The floor. Every assertion above passes on its own if all five paths render
  // the same sentence, so the last thing asked is whether they differ.
  it('gives five refusals five different sentences', () => {
    const shown = [
      refusal(409, 'USERNAME_TAKEN'),
      refusal(429, 'RENAME_RATE_LIMITED'),
      localRefusal('ab'),
      localRefusal('ana besi'),
      FALLBACK,
    ];
    expect(new Set(shown).size).toBe(shown.length);
  });
});
