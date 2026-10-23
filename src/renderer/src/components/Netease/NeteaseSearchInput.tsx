import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { neteaseQuery } from '../../queries/netease';

interface NeteaseSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter submits the raw typed text; picking a suggestion calls this with it instead. */
  onSubmit: (keyword: string) => void;
  placeholder: string;
  ariaLabel: string;
  autoFocus?: boolean;
}

const SUGGEST_DEBOUNCE_MS = 250;

/**
 * The inner content of a NetEase search input (icon, text field, clear button) plus its
 * keyword-suggestion dropdown, built on Headless UI's `Combobox` for keyboard navigation,
 * outside-click dismissal and the portaled option list (whose `anchor` keeps tracking the input
 * through layout shifts). The list opens on typing, not on focus: the search page auto-focuses
 * its input and replays an enter animation on every mount, and an opening list would anchor to
 * the input's mid-animation position.
 *
 * The pill-shaped shell stays with the caller — its width differs per page — while this component
 * fills it. Suggestions debounce 250 ms and are cached per keyword by react-query; Enter always
 * searches the typed text, while clicking (or arrowing into) a suggestion searches that one.
 */
const NeteaseSearchInput = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  ariaLabel,
  autoFocus
}: NeteaseSearchInputProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced copy of the input feeds the suggestion query, so typing feels instant while the
  // network sees one suggest request per 250 ms of settle time.
  const [debouncedKeywords] = useDebouncedValue(value, { wait: SUGGEST_DEBOUNCE_MS });
  const keywords = debouncedKeywords.trim();

  const { data: suggestions = [] } = useQuery({
    ...neteaseQuery.searchSuggest(keywords),
    enabled: keywords.length > 0,
    staleTime: 60_000
  });

  const submit = (keyword: string) => {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  };

  return (
    <Combobox
      value={value}
      onChange={(keyword) => {
        // Option selection lands here; a picked suggestion fills the field and runs the search
        // in one step.
        if (typeof keyword !== 'string') return;
        onChange(keyword);
        submit(keyword);
      }}
    >
      <div className="flex h-full w-full grow items-center">
        <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mx-3 text-2xl">
          search
        </span>
        <ComboboxInput
          ref={inputRef}
          aria-label={ariaLabel}
          placeholder={placeholder}
          displayValue={() => value}
          className="text-font-color-black placeholder:text-font-color-highlight dark:text-font-color-white dark:placeholder:text-dark-font-color-highlight h-full w-full border-2 border-[transparent] bg-[transparent] outline-hidden [&::-webkit-search-cancel-button]:hidden"
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            // Keystrokes in the search field must not reach the app's global shortcuts.
            e.stopPropagation();
            // Enter always searches what the user actually typed. Merged handler order puts this
            // first and skips Headless UI's own Enter branch once default is prevented — without
            // this, its default-to-first-option logic commits the top suggestion instead.
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(e.currentTarget.value);
            }
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
        {value.trim().length > 0 && (
          <button
            type="button"
            className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mr-3 cursor-pointer text-xl"
            aria-label={t('common.clearSearch')}
            title={t('common.clearSearch')}
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          >
            close
          </button>
        )}
      </div>
      <ComboboxOptions
        anchor="bottom start"
        // Headless UI writes inline `maxHeight: min(var(--anchor-max-height, 100vh), …px)`, which
        // outranks any max-h-* class; with few suggestions the list never overflowed, so wheel
        // events fell through to the page behind it. Cap it through the official variable.
        className="bg-background-color-1 dark:bg-dark-background-color-1 z-100 mt-1 w-[var(--input-width)] [--anchor-max-height:18rem] overflow-y-auto rounded-2xl p-2 shadow-xl empty:hidden"
      >
        {keywords.length > 0 &&
          suggestions.map((keyword) => (
            <ComboboxOption
              key={keyword}
              value={keyword}
              className="text-font-color-black dark:text-font-color-white flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm data-[focus]:bg-background-color-2 dark:data-[focus]:bg-dark-background-color-2"
            >
              <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight text-lg">
                search
              </span>
              <span className="truncate">{keyword}</span>
            </ComboboxOption>
          ))}
      </ComboboxOptions>
    </Combobox>
  );
};

export default NeteaseSearchInput;
