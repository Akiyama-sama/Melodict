import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SidebarTopBarRouteConfig } from '@common/sidebarTopBar';

import NeteaseSearchInput from '../Netease/NeteaseSearchInput';

interface SidebarTopBarSearchProps {
  search: SidebarTopBarRouteConfig['search'];
}

/**
 * The search input of the shared top bar. Typing a keyword (with NetEase keyword suggestions in a
 * dropdown) navigates to the configured results route, which owns the results UI. Extracted so
 * future widgets (NetEase account chips, sync status…) can sit beside it in `SidebarTopBar`
 * without every page re-implementing the shell.
 */
const SidebarTopBarSearch = ({ search }: SidebarTopBarSearchProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState('');

  const goToSearch = (keyword: string) => {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) return;
    navigate({ to: search.to, search: { keyword: trimmed, ...search.search } });
  };

  return (
    <div className="bg-background-color-2 dark:bg-dark-background-color-2 flex h-11 w-full max-w-4xl grow items-center rounded-3xl px-2">
      <NeteaseSearchInput
        value={value}
        onChange={setValue}
        onSubmit={goToSearch}
        placeholder={t('netease.searchPlaceholder')}
        ariaLabel={t('netease.searchTitle')}
      />
    </div>
  );
};

export default SidebarTopBarSearch;
