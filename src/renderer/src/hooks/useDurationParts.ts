import { useMemo } from 'react';

/**
 * Formats a duration in seconds as padded `mm:ss` parts for the song-row duration column.
 * Non-finite inputs (NaN/Infinity) render as the fallback pair; `0` is a valid duration and
 * formats as `00:00`. `missing` lets each caller keep its own empty-state value.
 *
 * Deliberately separate from `utils/calculateTime`, which clamps negative/NaN inputs to
 * `00:00` for seek-bar positions — the row display wants a placeholder instead.
 */
const useDurationParts = (
  duration: number | undefined,
  missing: string | undefined = undefined
): { minutes: string | undefined; seconds: string | undefined } =>
  useMemo(() => {
    const addZero = (num: number) => {
      if (num < 10) return `0${num}`;
      return num.toString();
    };

    const min = Math.floor((duration || 0) / 60);
    const sec = Math.floor((duration || 0) % 60);

    return {
      minutes: Number.isNaN(min) ? missing : addZero(min),
      seconds: Number.isNaN(sec) ? missing : addZero(sec)
    };
  }, [duration, missing]);

export default useDurationParts;
