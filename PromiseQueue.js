// PromiseQueue.js

class PromiseQueue {
  constructor() {
    this.queue = Promise.resolve();
  }

  add(fn, delay = 0) {
    this.queue = this.queue
      .then(() => new Promise((resolve) => setTimeout(resolve, delay)))
      .then(fn)
      .catch((err) => console.error(err));
  }
}

module.exports = PromiseQueue;
