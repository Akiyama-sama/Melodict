import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Hook that navigates back in the router history when the mouse's side back button (button 3) is
 * released.
 *
 * Only fires while there is a page to go back to, so the button does nothing on the first page of
 * the session. Does not return any values - it automatically manages the mouse event listener and
 * cleanup.
 *
 * @example
 *   ```tsx
 *   function App() {
 *     useMouseBackButtonNavigation();
 *
 *     return <div>...</div>;
 *   }
 *   ```;
 */
const useMouseBackButtonNavigation = () => {
  const { history } = useRouter();

  useEffect(() => {
    const handleMouseBackButton = (e: MouseEvent) => {
      if (e.button !== 3 || !history.canGoBack()) return;

      e.preventDefault();
      history.back();
    };

    window.addEventListener('mouseup', handleMouseBackButton);

    return () => window.removeEventListener('mouseup', handleMouseBackButton);
  }, [history]);
};

export default useMouseBackButtonNavigation;
