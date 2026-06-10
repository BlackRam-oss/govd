const locks = new Map();

export function acquireQueue(key) {
  return new Promise(resolve => {
    if (!locks.has(key)) {
      locks.set(key, { locked: false, queue: [] });
    }
    const lock = locks.get(key);
    if (!lock.locked) {
      lock.locked = true;
      resolve();
    } else {
      lock.queue.push(resolve);
    }
  });
}

export function releaseQueue(key) {
  const lock = locks.get(key);
  if (!lock) return;
  if (lock.queue.length > 0) {
    const next = lock.queue.shift();
    next();
  } else {
    lock.locked = false;
    locks.delete(key);
  }
}
