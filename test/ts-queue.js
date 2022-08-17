

var test = require('tape')
var TsQueue = require('../ts-queue')

test('simple', function (t) {

  var q = new TsQueue()
  var called = false, ts = null
  t.equal(q.ts, 0)
  q.delay(10, (_ts)=>{ts = _ts; called = true})
  t.equal(q.ts, 0)
  t.equal(ts, null)
  q.drain(11)
  t.equal(ts, 10)
  t.equal(q.ts, 10)
  t.equal(called, true)
  t.end()
})

test('timer', function (t) {

  var q = new TsQueue()
  var called = 0
  t.equal(q.ts, 0)
  q.timer(1, 10, ()=>{called ++})
  t.equal(q.ts, 0)
  q.drain(10)
  t.equal(q.ts, 1)
  t.equal(called, 1)
  q.drain(100)
  t.equal(called, 10)
  t.equal(q.ts, 91)
  q.drain(1000)
  t.equal(q.ts, 991)
  t.equal(called, 100)
  t.end()

})