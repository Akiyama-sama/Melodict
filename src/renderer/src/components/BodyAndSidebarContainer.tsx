import { Outlet } from '@tanstack/react-router';

import ErrorBoundary from './ErrorBoundary';
// import Body from './Body';
import Sidebar from './Sidebar/Sidebar';
import SidebarTopBar from './SidebarTopBar/SidebarTopBar';

const BodyAndSideBarContainer = () => {
  return (
    <div className="body-and-side-bar-container relative flex h-full w-full overflow-hidden">
      <ErrorBoundary>
        <Sidebar />
        {/* The shared top bar lives in the shell above the routed page, so every sidebar page
            gets it from one place; pages keep scrolling independently below it. */}
        <div className="body relative order-2 flex h-full! w-full flex-col overflow-hidden rounded-tl-lg *:overflow-x-hidden lg:pl-14">
          <SidebarTopBar />
          <div className="min-h-0 w-full grow overflow-hidden">
            <Outlet />
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
};

export default BodyAndSideBarContainer;
