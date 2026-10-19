// Imported through `react-store`, which re-exports it: `@tanstack/store` is only a transitive
// dependency, and pnpm's isolated node_modules layout would not resolve it directly.
import { Store } from '@tanstack/react-store';
import { cloneDeep } from 'es-toolkit/object';

import {
  type AppReducer,
  type AppReducerStateActions,
  createDefaultReducerData,
  reducer as appReducer
} from '../other/appReducer';
import { LOCAL_STORAGE_DEFAULT_TEMPLATE } from '../other/localStorageTemplate';
import addMissingPropsToAnObject from '../utils/addMissingPropsToAnObject';
import storage from '../utils/localStorage';
// import hasDataChanged from '../utils/hasDataChanged';

/**
 * `utils/localStorage` imports this module, so the module body must not touch its bindings
 * while the graph is still evaluating — a top-level call here used to throw "Cannot access
 * 'storage' before initialization" whenever the cycle was entered through `utils/localStorage`
 * first. The persisted value is therefore read inline (with missing properties filled from the
 * template so the initial state is complete), and the check + post-check sync are exported for
 * `index.tsx` to run once every module has finished loading.
 */
const readPersistedLocalStorage = (): LocalStorage => {
  try {
    const persistedData = window.localStorage.getItem('localStorage');
    if (persistedData) {
      return addMissingPropsToAnObject(LOCAL_STORAGE_DEFAULT_TEMPLATE, JSON.parse(persistedData));
    }
  } catch (error) {
    console.error(error);
  }
  return LOCAL_STORAGE_DEFAULT_TEMPLATE;
};

export const store = new Store(createDefaultReducerData(readPersistedLocalStorage()));

type StoreSubscriptionState =
  | AppReducer
  | {
      currentVal?: AppReducer;
      prevVal?: AppReducer;
    };

const getCurrentStoreState = (subscriptionState: StoreSubscriptionState): AppReducer => {
  if ('currentVal' in subscriptionState && subscriptionState.currentVal) {
    return subscriptionState.currentVal;
  }

  return subscriptionState as AppReducer;
};

export const dispatch = (options: AppReducerStateActions) => {
  store.setState((state) => {
    return appReducer(state, options);
  });
};

export const reducer = () => {
  return { state: store.state, dispatch };
};

/**
 * Runs the storage check (repair/migration), syncs the repaired value into the store and
 * persists every later state change. Called from `index.tsx` — after the whole module graph
 * has been evaluated — instead of at module scope, so this module never touches `storage`
 * bindings while the `store <-> utils/localStorage` cycle is still initializing.
 */
export const initializeStore = () => {
  storage.checkLocalStorage();

  dispatch({
    type: 'UPDATE_LOCAL_STORAGE',
    data: storage.getLocalStorage()
  });

  store.subscribe((state) => {
    const currentState = getCurrentStoreState(state as StoreSubscriptionState);

    if (!currentState?.localStorage) {
      return;
    }

    storage.setLocalStorage(currentState.localStorage);

    // const modified = hasDataChanged(state.prevVal, state.currentVal);
    // const onlyModified = Object.groupBy(
    //   Object.entries(modified),
    //   ([, value]) => `${value.isModified}`
    // );

    if (window.api.properties.isInDevelopment) {
      console.debug('store state changed:', cloneDeep(currentState));
    }
  });
};
