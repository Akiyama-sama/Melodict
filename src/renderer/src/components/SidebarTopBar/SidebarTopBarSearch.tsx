import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SidebarTopBarRouteConfig } from '@common/sidebarTopBar';

interface SidebarTopBarSearchProps {
  search: SidebarTopBarRouteConfig['search'];
}

/**
 * The search input of the shared top bar. Typing a keyword navigates to the configured results
 * route, which owns the results UI; this component holds no results of its own. Extracted so
 * future widgets (NetEase account chips, sync status…) can sit beside it in `SidebarTopBar`
 * without every page re-implementing the shell.
 */
const SidebarTopBarSearch = ({ search }: SidebarTopBarSearchProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const goToSearch = (keyword: string) => {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) return;
    navigate({ to: search.to, search: { keyword: trimmed, ...search.search } });
  };

  return (
    <div className="bg-background-color-2 dark:bg-dark-background-color-2 flex h-11 w-full max-w-4xl grow items-center rounded-3xl px-2">
      <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mx-3 text-2xl">
        search
      </span>
      <input
        type="search"
        ref={inputRef}
        className="text-font-color-black placeholder:text-font-color-highlight dark:text-font-color-white dark:placeholder:text-dark-background-color-2 h-full w-full border-2 border-[transparent] bg-[transparent] outline-hidden"
        aria-label={t('netease.searchTitle')}
        placeholder={t('netease.searchPlaceholder')}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') goToSearch(e.currentTarget.value);
        }}
      />
      {value.trim().length > 0 && (
        <button
          type="button"
          className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mr-3 cursor-pointer text-xl"
          aria-label={t('common.clearSearch')}
          title={t('common.clearSearch')}
          onClick={() => {
            setValue('');
            inputRef.current?.focus();
          }}
        >
          close
        </button>
      )}
    </div>
  );
};

export default SidebarTopBarSearch;
