var Heap = require('heap')

function cmp (a, b) {
  return a.ts - b.ts
}

module.exports = class TsQueue extends Heap {
  constructor () {
    super(cmp)
    this.ts = 0
  }
  push () {
    throw new Error('private:push')
  }
  delay (delay, fn) {
    if(delay <= 0) throw new Error('delay must be positive')
    super.push({ts:this.ts+delay, fn})
  }
  drain (ts) {
    while(this.size() && this.peek().ts < ts) {
      var item = this.pop()
      if(!(this.ts <= item.ts)) {
        throw new Error('time cannot go backwards')
      }
      this.ts = item.ts
      item.fn(item.ts)
    }
  }
  drainSteps(s) {
    while(this.size() && s--) {
      var item = this.pop()
      if(!(this.ts < item.ts)) throw new Error('time cannot go backwards')
      this.ts = item.ts
      item.fn(item.ts)
    }
  }
  timer (delay, repeat, fn) {
    if(delay < 0) throw new Eror('delay < 0')
    if(repeat < 0) throw new Eror('repeat < 0')

    if(!repeat)
      this.delay(delay, fn)
    else {
      var self = this
      function next (ts) {
        if(fn(ts) !== false) {
          self.delay(repeat, next)
        }
      }
      this.delay(delay || repeat, next)
    }
  }
}