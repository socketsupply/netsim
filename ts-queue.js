const Heap = require('heap')

function cmp (a, b) {
  return a.ts - b.ts
}

function assertForwards (curr_ts, next_ts) {
  if (!(curr_ts < next_ts)) { throw new Error('time cannot go backwards, current ' + curr_ts + ' should have been before next item:' + next_ts) }
}

module.exports = class TsQueue extends Heap {
  constructor () {
    super(cmp)
    this.ts = 1
  }

  push () {
    throw new Error('private:push')
  }

  delay (delay, fn) {
    if (delay <= 0) throw new Error('delay must be positive')
    if (isNaN(delay)) throw new Error('cannot delay NaN:' + delay)
    super.push({ ts: this.ts + delay, fn })
  }

  drain (ts) {
    while (this.size() && this.peek().ts < ts) {
      const item = this.pop()
      if (!(this.ts <= item.ts)) {
        // wtf
      }
      this.ts = item.ts
      item.fn(item.ts)
    }
  }

  drainSteps (s) {
    while (this.size() && s--) {
      const item = this.pop()
      assertForwards(this.ts, item.ts)
      this.ts = item.ts
      item.fn(item.ts)
    }
  }

  timer (delay, repeat, fn) {
    if (delay < 0) throw new Error('delay < 0')
    if (repeat < 0) throw new Error('repeat < 0')

    if (!repeat) { this.delay(delay, fn) } else {
      const self = this
      function next (ts) {
        if (fn(ts) !== false) {
          self.delay(repeat, next)
        }
      }
      this.delay(delay || repeat, next)
    }
  }
}
