import { useCallback, useEffect, useRef } from "react";

/**
 * Per-FIELD debounced saving for a drafting form, with a flush. A single
 * shared timer silently dropped a field's save when the person moved to
 * another field within the delay. `flush()` runs every save still waiting,
 * now: Submit calls it first, so the check reads the text on screen.
 */
export function useDebouncedFields(onFieldChange: (field: string, value: string) => void, delayMs = 800) {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const waiting = useRef<Record<string, () => void>>({});
  const latest = useRef(onFieldChange);
  useEffect(() => {
    latest.current = onFieldChange;
  }, [onFieldChange]);

  /** Run `save` after the delay, replacing any save waiting under `key`. */
  const schedule = useCallback(
    (key: string, save: () => void) => {
      waiting.current[key] = save;
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        delete waiting.current[key];
        save();
      }, delayMs);
    },
    [delayMs],
  );

  /** onChange for a text field. */
  const handleChange = useCallback(
    (field: string) => (e: { target: { value: string } }) => {
      const value = e.target.value;
      schedule(field, () => latest.current(field, value));
    },
    [schedule],
  );

  const flush = useCallback(() => {
    const saves = Object.entries(waiting.current);
    waiting.current = {};
    for (const [key, save] of saves) {
      clearTimeout(timers.current[key]);
      save();
    }
  }, []);

  // Leaving the page saves what was typed rather than dropping it.
  useEffect(() => flush, [flush]);

  return { handleChange, schedule, flush };
}
