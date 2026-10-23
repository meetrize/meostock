/**
 * 简单并发池：同时最多 limit 个 Promise 在跑。
 * @param {number} limit
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
export function createPool(limit = 4) {
  const max = Math.max(1, Number(limit) || 4);
  let active = 0;
  const queue = [];

  function pump() {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return function schedule(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}
