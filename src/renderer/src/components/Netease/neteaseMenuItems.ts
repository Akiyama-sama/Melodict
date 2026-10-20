import type { TFunction } from 'i18next';
import type { useNavigate } from '@tanstack/react-router';

import type { AppUpdateContextType } from '../../contexts/AppUpdateContext';
import type { useQueueOperations } from '../../hooks/useQueueOperations';

type QueueOperations = ReturnType<typeof useQueueOperations>;
type Navigate = ReturnType<typeof useNavigate>;

interface NeteaseSongMenuContext {
  songId: number;
  title: string;
  /** `summary.album` — when absent the "go to album" item renders disabled. */
  album: { albumId: number; name: string } | undefined;
}

interface NeteaseSongMenuDependencies {
  addToNext: QueueOperations['addToNext'];
  addToEnd: QueueOperations['addToEnd'];
  addNewNotifications: AppUpdateContextType['addNewNotifications'];
  navigate: Navigate;
  /** The caller's play handler (the queue page wraps it with queue-context setup). */
  handlePlayBtnClick: () => void;
}

/**
 * The play / play-next / add-to-queue / go-to-album items shared verbatim by the NetEase song
 * card and song row context menus. Caller-specific items (like, go to artist, page extras) stay
 * with the caller; the row prepends its extras (e.g. "remove from queue") via `items.unshift`.
 */
const buildNeteasePlaybackMenuItems = (
  { songId, title, album }: NeteaseSongMenuContext,
  { addToNext, addToEnd, addNewNotifications, navigate, handlePlayBtnClick }: NeteaseSongMenuDependencies,
  t: TFunction
): ContextMenuItem[] => [
  {
    label: t('common.play'),
    iconName: 'play_arrow',
    handlerFunction: handlePlayBtnClick
  },
  {
    label: t('common.playNext'),
    iconName: 'shortcut',
    handlerFunction: () => {
      addToNext([songId], { removeDuplicates: false });
      addNewNotifications([
        {
          id: `${title}PlayNext`,
          content: t('notifications.playingNext', { title }),
          iconName: 'shortcut'
        }
      ]);
    }
  },
  {
    label: t('common.addToQueue'),
    iconName: 'queue',
    handlerFunction: () => {
      addToEnd([songId], { removeDuplicates: false });
      addNewNotifications([
        {
          id: `${title}AddedToQueue`,
          content: t('notifications.addedToQueue', { count: 1 }),
          iconName: 'queue'
        }
      ]);
    }
  },
  {
    label: 'Hr',
    isContextMenuItemSeperator: true,
    handlerFunction: () => true
  },
  {
    label: t('song.goToAlbum'),
    iconName: 'album',
    isDisabled: !album,
    handlerFunction: () =>
      album &&
      navigate({
        to: '/main-player/netease/albums/$albumId',
        params: { albumId: String(album.albumId) }
      })
  }
];

export default buildNeteasePlaybackMenuItems;
