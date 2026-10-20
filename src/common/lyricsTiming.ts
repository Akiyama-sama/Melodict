/**
 * Tolerance (ms) for matching a human-authored romanization line (NetEase `romalrc`) onto a main
 * lyric line by timestamp. Single source for the app's `attachRomanizedText` and the evaluation
 * harness's romanized-alignment — the two must stay in lockstep or the harness would measure a
 * pipeline the app never runs.
 *
 * 300ms rationale: contributors re-sync romalrc by hand, so timestamps drift a few tens of ms
 * from the main lyrics — well under this bound — while neighboring lyric lines are typically
 * 2-5s apart, so anything above that would start attaching the next (or previous) line's
 * romanization. 300ms sits safely between the two failure modes.
 */
export const ROMALRC_MATCH_WINDOW_MS = 300;
