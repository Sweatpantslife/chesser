import { useEffect, useRef } from 'react';

/**
 * A ref for a `setTimeout` handle that is automatically cleared on unmount, so
 * a pending tick can never fire into an unmounted trainer. Callers still clear
 * it manually when scheduling over it or invalidating it (e.g. loading the
 * next puzzle).
 */
export function useTimeoutRef() {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (ref.current) clearTimeout(ref.current);
    };
  }, []);
  return ref;
}
