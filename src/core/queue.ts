interface LockEntry {
  locked: boolean;
  queue: Array<() => void>;
}

const locks = new Map<string, LockEntry>();

export function acquireQueue(key: string): Promise<void> {
  return new Promise(resolve => {
    if (!locks.has(key)) {
      locks.set(key, { locked: false, queue: [] });
    }
    const lock = locks.get(key)!;
    if (!lock.locked) {
      lock.locked = true;
      resolve();
    } else {
      lock.queue.push(resolve);
    }
  });
}

export function releaseQueue(key: string): void {
  const lock = locks.get(key);
  if (!lock) return;
  if (lock.queue.length > 0) {
    const next = lock.queue.shift()!;
    next();
  } else {
    lock.locked = false;
    locks.delete(key);
  }
}
