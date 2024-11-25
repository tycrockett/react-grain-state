import { useCallback, useEffect, useRef, useState } from "react";
import * as uuid from "uuid";

const createSelector = (path) => {
  const selector = (obj) => {
    return path.reduce((acc, key) => acc?.[key], obj);
  };
  selector.id = uuid.v4();
  selector.path = path;
  return selector;
};

const dataSetter = (object, selector, newValue) => {
  const path = selector.path;
  if (!path) {
    throw new Error('Selector must have a "path" property for setting.');
  }
  let current = object;
  for (let i = 0; i < path.length - 1; i++) {
    current = current[path[i]];
  }
  current[path[path.length - 1]] = newValue;
};

class ListenerTree {
  constructor() {
    this.tree = {};
  }

  add(path, callback) {
    let node = this.tree;
    for (const key of path) {
      if (!node[key]) {
        node[key] = { __listeners: [] };
      }
      node = node[key];
    }
    node.__listeners.push(callback);
  }

  remove(path, callback) {
    let node = this.tree;
    const stack = [];
    for (const key of path) {
      if (!node[key]) return; // Path doesn't exist
      stack.push([node, key]);
      node = node[key];
    }
    node.__listeners = node.__listeners.filter((cb) => cb !== callback);

    // Clean up empty nodes
    while (stack.length) {
      const [parent, key] = stack.pop();
      if (
        Object.keys(parent[key]).length === 1 &&
        parent[key].__listeners.length === 0
      ) {
        delete parent[key];
      } else {
        break;
      }
    }
  }

  notify(path) {
    const notifyCallbacks = (node) => {
      if (!node) return;
      (node.__listeners || []).forEach((cb) => cb(Date.now()));
      for (const key of Object.keys(node)) {
        if (key !== "__listeners") notifyCallbacks(node[key]);
      }
    };

    // Notify exact path
    let node = this.tree;
    for (const key of path) {
      if (!node[key]) break;
      node = node[key];
    }
    notifyCallbacks(node);

    // Notify parent paths
    let parentNode = this.tree;
    for (const key of path) {
      if (parentNode.__listeners) {
        parentNode.__listeners.forEach((cb) => cb(Date.now()));
      }
      parentNode = parentNode[key];
    }
  }

  notifyAll() {
    const traverseAndNotify = (node) => {
      if (!node || typeof node !== "object") return;

      // Notify listeners
      if (Array.isArray(node.__listeners)) {
        node.__listeners.forEach((cb) => {
          if (typeof cb === "function") {
            try {
              cb(Date.now());
            } catch (err) {
              console.error("Callback error:", err);
            }
          }
        });
      }

      // Traverse child nodes
      for (const key of Object.keys(node)) {
        if (key !== "__listeners" && typeof node[key] === "object") {
          traverseAndNotify(node[key]);
        }
      }
    };

    traverseAndNotify(this.tree);
  }
}

export const useNexus = (initialData) => {
  const stateRef = useRef(initialData);
  const listeners = useRef(new ListenerTree());
  const state = stateRef.current;

  const [nexusUpdateAt, setNexusUpdateAt] = useState(null);

  const setState = (valueOrFunction) => {
    if (typeof valueOrFunction === "function") {
      stateRef.current = valueOrFunction(state);
    } else {
      stateRef.current = valueOrFunction;
    }
    setNexusUpdateAt(Date.now());
  };

  const setNexusWithSelector = (selector, newValue) => {
    dataSetter(state, selector, newValue);
    listeners.current.notify(selector.path);
  };

  const addListener = (selector, callback) => {
    listeners.current.add(selector.path, callback);
  };

  const removeListener = (selector, callback) => {
    listeners.current.remove(selector.path, callback);
  };

  return {
    current: state,
    set: setState,
    link: {
      setNexusWithSelector,
      addListener,
      removeListener,
      nexusUpdateAt,
      logListeners: () => console.log(listeners.current),
    },
  };
};

export const useLink = (state, options = {}) => {
  const {
    path = [],
    initialData = null,
    subscribed = true,
    muted = false,
  } = options;
  const selector = useRef(createSelector(path)).current;
  const [data, setData] = useState(
    () => selector(state.current) || initialData
  );
  const [linkKey, setLinkKey] = useState(selector.id);

  const updateLinkKey = () => {
    const time = Date.now();
    const key = `${selector.id}-${time}`;
    setLinkKey(key);
  };

  const setter = useCallback(
    (newValue) => {
      setData(newValue);
      if (!muted) {
        state.link.setNexusWithSelector(selector, newValue);
      }
    },
    [state.current, selector, muted]
  );

  const updateLinkFromNexus = useCallback(() => {
    if (subscribed) {
      const newData = () => selector(state.current);
      setData(newData);
    }
  }, [subscribed, selector, state.current]);

  useEffect(() => {
    state.link.removeListener(selector, updateLinkFromNexus);
    if (subscribed) {
      state.link.addListener(selector, updateLinkFromNexus);
    }
    return () => {
      state.link.removeListener(selector, updateLinkFromNexus);
    };
  }, [updateLinkFromNexus, subscribed]);

  const updateSelector = () => {
    selector.current = createSelector(path);
    updateLinkKey();
  };

  useEffect(() => {
    updateSelector();
    updateLinkFromNexus();
  }, [state?.link?.nexusUpdateAt]);

  return {
    data,
    set: setter,
    setData,
    metadata: {
      updateKey: updateLinkKey,
      key: linkKey,
      selector,
    },
  };
};

export const propagateLink = (state, link) => {
  const { data, metadata } = link;
  state.link.setNexusWithSelector(metadata?.selector, data);
};

export const syncLink = (state, link) => {
  const { set, metadata } = link;
  const newData = metadata?.selector(state.current);
  set(newData);
};
