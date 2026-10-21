/**
 * Per-route configuration for the shared top bar rendered by the main-player shell above the
 * page content (see `renderer/components/SidebarTopBar`). The shell looks the current pathname
 * up here; pages themselves render nothing, which keeps "which pages have the bar" a single
 * decision instead of an edit scattered across every page component.
 */
export type SidebarTopBarRouteConfig = {
  search: {
    /** Route a submitted keyword navigates to; that page owns the results UI. */
    to: string;
    /** Search params forwarded alongside the keyword. */
    search: Record<string, string>;
  };
};

/**
 * Every sidebar page that shows the bar. Currently every entry points at the NetEase search
 * route with a page-appropriate default filter; pages that later want a different destination
 * (e.g. local library search) only change their entry here.
 */
export const SIDEBAR_TOP_BAR_ROUTES: Record<string, SidebarTopBarRouteConfig> = {
  '/main-player/home': { search: { to: '/main-player/netease/search', search: { filterBy: 'songs' } } },
  '/main-player/songs': { search: { to: '/main-player/netease/search', search: { filterBy: 'songs' } } },
  '/main-player/playlists': { search: { to: '/main-player/netease/search', search: { filterBy: 'playlists' } } },
  '/main-player/folders': { search: { to: '/main-player/netease/search', search: { filterBy: 'songs' } } },
  '/main-player/artists': { search: { to: '/main-player/netease/search', search: { filterBy: 'artists' } } },
  '/main-player/albums': { search: { to: '/main-player/netease/search', search: { filterBy: 'albums' } } },
  '/main-player/genres': { search: { to: '/main-player/netease/search', search: { filterBy: 'songs' } } },
  '/main-player/netease/playlists': {
    search: { to: '/main-player/netease/search', search: { filterBy: 'playlists' } }
  },
  '/main-player/netease/liked': { search: { to: '/main-player/netease/search', search: { filterBy: 'songs' } } },
  '/main-player/netease/toplists': {
    search: { to: '/main-player/netease/search', search: { filterBy: 'songs' } }
  }
};
