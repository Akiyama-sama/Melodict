/**
 * The "active" treatment shared by the toggle buttons that light up while their feature is on: the
 * icon takes the theme accent and the short underline bar (the button's ::after) becomes visible.
 * Used by the analysis-view toggle, the mute toggle, and the analysis-panel toggle in the title
 * bar — the class string must stay character-identical everywhere.
 */
export const TOGGLE_ACTIVE_BAR = 'text-dark-background-color-3! after:opacity-100';

/**
 * The shared layout block of the title-bar special-control buttons (flex centering, spacing,
 * rounded corners, transparent background, focus outline). The two toggle buttons differ around
 * it — the analysis-panel button adds `relative` before this block (it hosts an absolutely
 * positioned active bar) and an `after:*` band after it — so only this contiguous run is
 * extracted; the class string produced at each call site must stay character-identical.
 */
export const TITLEBAR_ICON_BTN_BASE =
  'flex cursor-pointer items-center justify-center rounded-md !border-0 bg-transparent !px-3 !py-1 text-center text-xl outline-offset-1 transition-[color,background] ease-in-out focus-visible:!outline dark:bg-transparent ';
