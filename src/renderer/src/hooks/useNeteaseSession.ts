import { neteaseQuery } from '@renderer/queries/netease';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * Exposes the current NetEase session profile with derived login flags, so section pages can gate
 * their queries with `enabled` without spreading StrictOptions factory objects themselves.
 */
export function useNeteaseSession() {
  const { data: profile, isLoading, dataUpdatedAt } = useQuery(neteaseQuery.session);

  const isLoggedIn = !!profile?.userId;

  return useMemo(() => ({ profile, isLoggedIn, isLoading, dataUpdatedAt }), [
    profile,
    isLoading,
    dataUpdatedAt
  ]);
}
