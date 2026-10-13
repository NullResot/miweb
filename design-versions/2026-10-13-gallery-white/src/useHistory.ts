import { useCallback, useRef, useState } from "react";
import type { Changes } from "./types";

export function useHistory() {
  const timeline = useRef<Changes[]>([{}]);
  const cursor = useRef(0);
  const [changes, setChanges] = useState<Changes>({});
  const [revision, setRevision] = useState(0);
  const reset = useCallback((initial: Changes = {}) => {
    timeline.current = [initial];
    cursor.current = 0;
    setChanges(initial);
    setRevision((value) => value + 1);
  }, []);
  const commit = useCallback((next: Changes) => {
    if (
      JSON.stringify(next) === JSON.stringify(timeline.current[cursor.current])
    )
      return;
    timeline.current = [
      ...timeline.current.slice(0, cursor.current + 1),
      structuredClone(next),
    ].slice(-101);
    cursor.current = timeline.current.length - 1;
    setChanges(next);
    setRevision((value) => value + 1);
  }, []);
  const undo = useCallback(() => {
    if (cursor.current > 0) {
      cursor.current--;
      setChanges(timeline.current[cursor.current]);
      setRevision((value) => value + 1);
    }
  }, []);
  const redo = useCallback(() => {
    if (cursor.current < timeline.current.length - 1) {
      cursor.current++;
      setChanges(timeline.current[cursor.current]);
      setRevision((value) => value + 1);
    }
  }, []);
  return {
    changes,
    commit,
    reset,
    undo,
    redo,
    canUndo: cursor.current > 0,
    canRedo: cursor.current < timeline.current.length - 1,
    revision,
  };
}
