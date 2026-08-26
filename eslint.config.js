import { ADONIS_IGNORE_LIST, configApp, INCLUDE_LIST } from '@adonisjs/eslint-config'

export default configApp({
  name: 'padel app overrides',
  /**
   * Same scope as the preset's own block. `ADONIS_IGNORE_LIST` matters here: without it
   * this block would re-enable linting for `.adonisjs/**`, which is codegen output
   * regenerated on every boot.
   */
  files: INCLUDE_LIST,
  ignores: ADONIS_IGNORE_LIST,
  rules: {
    /**
     * `x != null` is used deliberately across this codebase as the single check for
     * "neither null nor undefined", and several reads depend on catching `undefined`.
     * The clearest case is the `Record<string, string | null>` maps built from the
     * `settings` table: a key with no row is absent, so the lookup yields `undefined`,
     * and `!== null` would treat it as a present value — e.g. the professor hour guard
     * in `reservations_controller` would compute `Number(undefined)` and silently stop
     * blocking. `noUncheckedIndexedAccess` is off, so the type says `string | null` and
     * typecheck would not catch that regression either.
     *
     * Comparisons against anything other than null/undefined are still errors.
     */
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
})
