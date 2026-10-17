import { createQueryKeys } from '@lukemorales/query-key-factory';

export const neteaseQuery = createQueryKeys('netease', {
  // React Query rejects undefined results; map a logged-out null over the absent profile.
  session: {
    queryKey: null,
    queryFn: async () => (await window.api.neteaseControls.getMe()) ?? null
  }
});
