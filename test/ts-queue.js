

var test = require('tape')
var TsQueue = require('../ts-queue')

test('simple', function (t) {

  var q = new TsQueue()
  var called = false, ts = null
  t.equal(q.ts, 1)
  q.delay(1, (_ts)=>{ts = _ts; called = true})
  t.equal(q.ts, 1)
  t.equal(ts, null)
  q.drain(11)
//  t.equal(q.ts, 11)
  t.equal(q.ts, 2)
  t.equal(called, true)
  t.end()
})

test('timer', function (t) {

  var q = new TsQueue()
  var called = 0
  t.equal(q.ts, 1)
  q.timer(1, 10, ()=>{called ++})
  t.equal(q.ts, 1)
  q.drain(11)
  t.equal(q.ts, 2)
  t.equal(called, 1)
  q.drain(101)
  t.equal(called, 10)
  t.equal(q.ts, 92)
  q.drain(1001)
  t.equal(q.ts, 992)
  t.equal(called, 100)
  t.end()

})