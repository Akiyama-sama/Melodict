import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Search bar pinned to the top of the home page. Typing a keyword navigates straight to the
 * NetEase search route, which owns the results UI; this component holds no results of its own.
 */
const HomeSearchBar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const goToSearch = (keyword: string) => {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) return;
    navigate({
      to: '/main-player/netease/search',
      search: { keyword: trimmed, filterBy: 'songs' }
    });
  };

  return (
    <div className="appear-from-bottom home-search-bar-container mt-4 w-full pl-8">
      <div className="bg-background-color-2 dark:bg-dark-background-color-2 flex h-11 max-w-2xl items-center rounded-3xl px-2">
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
    </div>
  );
};

export default HomeSearchBar;
