var {iterate, Node, Network, IndependentNat, IndependentFirewallNat, DependentNat} = require('../index')
var network = new Network()

var test = require('tape')
function noop () {}

function assertFinished (t, network) {
  for(var ip in network.subnet) {
    t.deepEqual(network.subnet[ip].send, [])
//    t.deepEqual(network.subnet[ip].recv, [])
  }
}

test('network add and remove', function (t) {
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'
  var bb = 'bb.b.b.b'

  var network = new Network()
  var node = new Node(()=>{})
  network.add(a, node)
  t.equal(node.address, a)
  t.equal(network.subnet[a], node)
  network.add(b, node)
  t.equal(node.address, b)
  t.notEqual(network.subnet[a], node)
  t.equal(network.subnet[b], node)
  network.remove(node)
  t.equal(node.network, null)
  t.equal(node.address, null)

  var nat = new IndependentNat()

  nat.add(bb, node)
  t.equal(node.address, bb)
  network.add(b, nat)
  t.equal(nat.address, b)
  t.end()
})

test('echo', function (t) {
//  t.plan(2)
//  console.log(network)
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'
  var received = false
  var _ts = 0
  function createBPeer (send, timer, self, ts) {
    t.equal(ts, 0)
    send('hello', {address: a, port: 10}, 1)
    return function onMessage (msg, addr, port, ts) {
      console.log("RECV_A", msg, addr, port)
      t.equal(msg, 'hello')
      t.equal(port, 1)
      t.ok('number' === typeof ts)
      t.ok(ts > _ts)
      _ts = ts
    }
  }
  //echo the received message straight back.
  function createAPeer (send) {
    return function onMessage (msg, addr, port) {
      console.log("RECV_B", msg, addr, port)
      received = true
      t.equal(msg, 'hello')
      t.equal(port, 10)
      t.equal(addr.address, b)
      send(msg, addr, port)
    }
  }

//  network[a] = createNode(createAPeer)
//  network[b] = createNode(createBPeer)
  network.add(a,  new Node(createAPeer))
  network.add(b,  new Node(createBPeer))
//  console.log(network)
//  network[b] = createNode(createBPeer)
  network.iterate(-1)
  t.equal(received, true)
//  assertFinished(t, network)
//  console.log(JSON.stringify(network, null, 2))
  t.end()
})

//return

function createAssertMonotonic (t) {
  var _ts = 0
  return function assertMonotonic (ts) {
    t.equal(typeof ts, 'number')
    t.ok(ts > _ts, 'time is always increasing, '+ts+' > '+_ts)
    _ts = ts
  }

}

test('echo relay', function (t) {
  var assertMonotonic = createAssertMonotonic(t)
  var network = new Network()
//  t.plan(2)
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'
  var c = 'c.c.c.c'
  var received = false
  function createBPeer (send) {
    send({msg:'hello', forward: {address: a, port: 10}}, {address: c, port: 3}, 1)
    return function onMessage (msg, addr, port, ts) {
      t.equal(msg, 'hello')
      t.equal(port, 1)
      assertMonotonic(ts)
    }
  }
  //echo the received message straight back.
  function createAPeer (send) {
    return function onMessage (msg, addr, port, ts) {
      received = true
      t.equal(msg, 'hello')
      t.equal(port, 10)
      t.equal(addr.address, c)
      t.equal(addr.port, 3)
      assertMonotonic(ts)
      send({msg:msg, forward: {address:b, port: 1}}, addr, port)
    }
  }

  function createCPeer (send) {
    return function onMessage (msg, addr, port, ts) {
      t.equal(port, 3)
      send(msg.msg, msg.forward, port)
      assertMonotonic(ts)
    }
  }

//  network[a] = createNode(createAPeer)
//  network[b] = createNode(createBPeer)
//  network[c] = createNode(createCPeer)
  network.add(a, new Node(createAPeer))
  network.add(b, new Node(createBPeer))
  network.add(c, new Node(createCPeer))
  network.iterate(-1)
  t.equal(received, true, 'received message')
  //assertFinished(t, network)
  t.end()
})

//return
test('nat', function (t) {
  var assertMonotonic = createAssertMonotonic(t)
  var echos = 0, received = false
  var network = new Network()
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var a = 'a.a.a.a'
  //publically accessable echo server
  var nA, na
  network.add(A, nA = new Node((send) => (msg, addr, port, ts) => {
    echos++;
    console.log("ECHO:", msg, addr, port)
    //received address should be the nat's external address & the mapped port
    t.notEqual(addr.port, 1)
    t.equal(addr.address, B)
    assertMonotonic(ts)
    send(msg, addr, port)
  }))
  t.equal(nA.address, A)

  //var nat = network[B] = createNat('a.a.')
  var nat
  network.add(B, nat = new IndependentNat('a.a'))
  //nat.subnet = subnetwork
  t.equal(nat.address, B)
  nat.add(a, na = new Node((send) => {
    var hello = "HELLO FROM SUBNET"
    send(hello, {address: A, port: 10}, 1)
    return (msg, addr, port, ts) => {
      t.equal(msg, hello)
      //received address should be the external server's real address
      t.deepEqual(addr, {address: A, port: 10})
      received = true
      assertMonotonic(ts)
    }
  }))

  t.equal(na.address, a)

  network.iterate(-1)
//  console.log(JSON.stringify(network, null, 2))
  t.ok(received)
  t.equal(echos, 1)
  t.end()
})

test('nat must be opened by outgoing messages', function (t) {
  var assertMonotonic = createAssertMonotonic(t)

  var echos = 0, received = false, dropped = false
  var network = new Network()
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var a = 'a.a.a.a'
  //server sends message to nat, but it is not received
  network.add(A, new Node((send) => {
    send("ANYONE HOME?", {address:B, port:1}, 1)
    return (msg, addr, port) => {}
  }))
  var nat
  network.add(B, nat = new IndependentNat('a.a'))

  nat.add(a, new Node((send) => (msg, addr, port, ts) => {
    received = true
    assertMonotonic(ts)
  }))

  network.iterate(-1)
  t.equal(received, false)
  t.end()

})

test('nat (no firewall) must be opened by outgoing messages', function (t) {

  var echos = 0, received = false, dropped = false
  var network = new Network()
  network.drop = function () {
    dropped = true
  }
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var C = 'cc.cc.cc.cc'
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'

  //publically accessable rendevu server.
  //sends the source address back, so the natted'd peer knows it's external address
  network.add(C, node_c = new Node((send) => {
    send("ANYONE HOME?", {address:B,port:1}, 1)
    return (msg, addr, port) => {
      console.log("ECHO ADDR", {msg, addr, port})
      send(addr, addr, port)
    }
  }))
  var nat_A, nat_B, received_a = [], received_b = []
  network.add(B, nat_B = new IndependentNat('b.b.'))
  network.add(A, nat_A = new IndependentNat('a.a.'))
  //nat.subnet = subnetwork

  nat_A.add(a, node_a = new Node((send) => (msg, addr, port) => {
    received_a.push({msg, addr, port})
  }))
  nat_B.add(b, node_b = new Node((send) => (msg, addr, port) => {     
      received_b.push({msg, addr, port})
    }
  ))

  /*
  A ---------------> C
    <----,
         |
         |
  B -----`


  Alice opens an out going port by sending to C
  Bob can then send a message to that port.

  since only the port on the incoming packet is checked
  (and not the address) it goes through.
  Alice can now reply to B, by responding to that message.

  This means Alice has an empheral address, but any one can connect with her.
  It's the simplest kind of NAT because the port only has to be opened once.
  It's a NAT but no firewall
  */


  //Alice opens a port, by messaging the intro server C.
  node_a.send("A->C", {address: C, port: 1}, 10) 
  network.iterate(-1)

  t.ok(received_a.length)

  var echo = received_a.shift()
  t.deepEqual(echo.addr, {address:C, port: 1})
  t.equal(echo.msg.address, A)
  t.notEqual(echo.msg.port, 10)

  //Bob holepunches to Alice by sending to the port opened by previous message
  node_b.send("B-(holepunch)->A", {address: A, port: echo.msg.port}, 20) 
  network.iterate(-1)
  t.ok(received_a.length)
  var holepunch = received_a.shift()
  t.equal(holepunch.msg, "B-(holepunch)->A")
  t.equal(holepunch.addr.address, B)
  t.notEqual(holepunch.addr.port, 20)

  t.end()

})

test('nat (with firewall) must be opened by outgoing messages direct to peer', function (t) {

  var echos = 0, received = false, dropped = false
  var nat_A, nat_B, received_a = [], received_b = [], received_echo = []

  var network = new Network()
  network.drop = function () {
    dropped = true
  }
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var C = 'cc.cc.cc.cc'
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'

  //publically accessable rendevu server.
  //sends the source address back, so the natted'd peer knows it's external address
  network.add(C, node_c = new Node((send) => {
    send("ANYONE HOME?", {address:B, port: 1}, 1)
    return (msg, addr, port) => {
      received_echo.push({msg,addr,port})
      console.log("ECHO ADDR", {msg, addr, port})
      send(addr, addr, port)
    }
  }))
  network.add(B, nat_B = new IndependentFirewallNat('b.b.'))
  network.add(A, nat_A = new IndependentFirewallNat('a.a.'))
  //nat.subnet = subnetwork

  nat_A.add(a, node_a = new Node((send) => (msg, addr, port) => {
    received_a.push({msg, addr, port})
  }))
  nat_B.add(b, node_b = new Node((send) => (msg, addr, port) => {     
    received_b.push({msg, addr, port})
  }))

  /*

  A a--------> C
  x|
  ^|
  ||
  ov
  B


  Alice opens an out going port by sending to C
  Bob sends a message to that port, to open their firewall


  since only the port on the incoming packet is checked
  (and not the address) it goes through.
  Alice can now reply to B, by responding to that message.

  This means Alice has an empheral address, but any one can connect with her.
  It's the simplest kind of NAT because the port only has to be opened once.
  It's a NAT but no firewall
  */

//  network.iterate(-1)

  //the message sent to be should not have been received because firewall is not opened yet
  network.iterate(-1)
  t.equal(received_b.length, 0)

  //Alice opens a port, by messaging the intro server C.
  node_a.send("A->C", {address: C, port: 1}, 10) 
  node_b.send("B->C", {address: C, port: 1}, 10) 
  network.iterate(-1)

  t.equal(received_a.length, 1)
  t.equal(received_b.length, 1)

  t.ok(received_a.length)
  t.ok(received_b.length)
  
  var echo_a = received_a.shift()
  var echo_b = received_b.shift()
  t.deepEqual(echo_a.addr, {address:C, port: 1})
  t.equal(echo_a.msg.address, A)
  t.notEqual(echo_a.msg.port, 10)

  t.equal(Object.keys(nat_B.firewall).length, 1)

  //Bob opens a port for alice by sending a packet to her, but Alice's firewall does not let it through
  node_b.send("B-(holepunch)->A", {address: A, port: echo_a.msg.port}, 10) 
  network.iterate(-1)

  //this message did not get through but it did open B's firewall
  t.equal(received_a.length, 0)
  t.equal(received_b.length, 0)

  console.log(nat_B.firewall) ///XXX??? 
  console.log(received_echo)

  t.equal(Object.keys(nat_B.firewall).length, 2)


  //Alice holepunches to Body by sending to the port opened found from C, through the hole opened
  //by Bob's by previous message
  node_a.send("A-(holepunch)->B", {address: B, port: echo_b.msg.port}, 10) 
  network.iterate(-1)

  t.equal(received_b.length, 1)

  //Bob can now send to Alice
  node_b.send("B-(holepunch)->A", {address: A, port: echo_a.msg.port}, 10) 
  network.iterate(-1)

  t.equal(received_a.length, 1)

  t.end()
})

test('one side dependent nat requires birthday paradox', function (t) {

  var echos = 0, received = false, dropped = false
  var network = new Network()
  network.drop = function () {
    dropped = true
  }

  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var C = 'cc.cc.cc.cc'
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'

  //publically accessable rendevu server.
  //sends the source address back, so the natted'd peer knows it's external address
  network.add(C, node_c = new Node((send) => {
    send("ANYONE HOME?", {address:B,port:1}, 1)
    return (msg, addr, port) => {
      console.log("ECHO ADDR", {msg, addr, port})
      send(addr, addr, port)
    }
  }))

  var nat_A, nat_B, received_a = [], received_b = []
  if(true) {
    network.add(B, nat_B = new DependentNat('b.b.')) //AKA Symmetric NAT the hard side
    network.add(A, nat_A = new IndependentFirewallNat('a.a.')) //the easy side
  } else {
    network.add(B, nat_B = new IndependentFirewallNat('b.b.')) //AKA Symmetric NAT the hard side
    network.add(A, nat_A = new DependentNat('a.a.')) //the easy side
  }
  //nat.subnet = subnetwork

  nat_A.add(a, node_a = new Node((send) => (msg, addr, port) => {
    received_a.push({msg, addr, port})
  }))
  nat_B.add(b, node_b = new Node((send) => (msg, addr, port) => {     
    received_b.push({msg, addr, port})
  }))


  //Alice opens a port, by messaging the intro server C.
  node_a.send("A->C", {address: C, port: 1}, 10) 
//  node_b.send.push({msg: "A->B", addr: {address: C, port: 1}, port: 10}) 
  network.iterate(-1)

  t.ok(received_a.length)
//  t.ok(received_b.length)
  
  var echo_a = received_a.shift()
//  var echo_b = received_b.shift()
  t.deepEqual(echo_a.addr, {address:C, port: 1})
  t.equal(echo_a.msg.address, A)
  t.notEqual(echo_a.msg.port, 10)

  function create_rand_port () {
    var ports = {}
    return function () {
//      return ~~(Math.random() * 0xffff)
      while(ports[r = ~~(Math.random() * 0xffff)]);
      ports[r] = true
      return r
    }
  }
  var N = 64
  //B (Endpoint Dependant / Symmetrical Nat) opens 256 ports
  var rand_port = create_rand_port()
  for(var i = 0; i < N; i++) {
    //B the hard side opens 256 ports
    node_b.send("B-(hb:holepunch)->A", {address: A, port: echo_a.msg.port}, rand_port()) 
  }

  network.iterate(-1)
  t.equal(received_a.length, 0)

  
  var rand_port = create_rand_port()
  var tries = 0
  while(!received_b.length) {
    for(var i = 0; i < N; i++) {
      //the easy side sends messages to random ports
      node_a.send("B-(hb:holepunch)->A", {address: B, port: rand_port()}, 10) 
    }
    //console.log("ITERATE")
    tries += N
    network.iterate(-1)
  }
  console.log("connected after:", tries)
  t.notEqual(received_b.length, 0)
  received_a = []
  while(received_b.length) {
    var echo = received_b.shift()
    node_b.send("echo:"+echo.msg, echo.addr, echo.port)
    network.iterate(-1)
    t.equal(received_a.shift().msg, "echo:"+echo.msg)
  }
  t.end()
})

//to make a connection between two 

function test_hairpinning (name, Nat, supports_hairpinning) {
  test('hairpinning nat:'+name, function (t) {
    var network = new Network()

    var C = '1.2.0.0'
    var A = '1.2.3.4'
    var B = '1.2.5.6'
    var I = '5.5.5.5'

    var node_intro, node_A, node_B, nat, received_a = [], received_b = []

    network.add(I, node_intro = new Node((send) => {
      return (msg, addr, port) => {
        console.log("receive", msg, addr, port)
        send(addr, addr, port)
      }
    }))

    network.add(C, nat = new Nat('1.2.'))
    nat.hairpinning = supports_hairpinning
    //nat.subnet = subnetwork

    nat.add(A, node_a = new Node((send) => (msg, addr, port) => {
      received_a.push({msg, addr, port})
    }))
    nat.add(B, node_b = new Node((send) => (msg, addr, port) => {     
      received_b.push({msg, addr, port})
    }))

    node_a.send('hello1', {address:I, port: 1000}, 1000)
    node_b.send('hello2', {address:I, port: 1000}, 1000)

    network.iterate(-1)

    var addr_b = received_a.shift().msg
    var addr_a = received_b.shift().msg

    t.equal(addr_a.address, C, 'echo returned A an external address')
    t.equal(addr_b.address, C, 'echo returned B an external address')

    node_a.send('hairpin?', addr_b, 1000)
    node_b.send('hairpin?', addr_a, 1000)
    network.iterate(-1)

    console.log(received_a, received_b)
    t.equal(received_a.length == 1, supports_hairpinning, 'received messages via hairpinning b->a')
    t.equal(received_b.length == 1, supports_hairpinning,  'received messages via hairpinning a->b')

    received_a.shift()
    received_b.shift()

    node_a.send('direct', {address: B, port: 1000}, 1000)
    node_b.send('direct', {address: A, port: 1000}, 1000)
    network.iterate(-1)
    t.equal(received_a.length == 1, true, 'received direct message to private address b->a')
    t.equal(received_b.length == 1, true,  'received direct message to private address a->b')

    t.end()

  })
}

//Independent and IndependentFirewall support hairpinning, out of the box
//but Dependent does not.

test_hairpinning('Independent', IndependentNat, true)
test_hairpinning('IndependentFirewall', IndependentFirewallNat, true)
test_hairpinning('Independent', IndependentNat, false)
test_hairpinning('IndependentFirewall', IndependentFirewallNat, false)
test_hairpinning('Dependent', DependentNat, false)

test('timers, and iterateUntil', function (t) {
  var network = new Network()
  var c = 0
  network.timer(10, 100, ()=>{
    c++
  })
  console.log(network.heap)
  network.iterateUntil(1000)
  t.equal(c, 10)
  t.end()
})

test('offline', function (t) {
  var network = new Network()
  var received = []
  var echo_node = new Node(function (send) {
    return function (msg, addr, port) {
      console.log('received', msg)
      send(msg, addr, port)
    }
  })
  network.add('1.2.3.4', echo_node)  
  var addr = {address: '1.2.3.4', port:1234}
  var send
  var node = new Node(function (_send) {
    send = _send
    send('hello1', addr, 1234)
    return function (msg) {
      received.push(msg)
    }
  })
  network.add('5.6.7.8', node)

  network.iterate(-1)
  t.deepEqual(received, ['hello1'])
  network.remove(node)
  send('hello2', addr, 1234)

  network.iterate(-1)
  network.add('5.6.7.8', node)
  send('hello3', addr, 1234)
  network.iterate(-1)

  t.deepEqual(received, ['hello1', 'hello3'])
  t.end()

})

test('sleeping while timer', function (t) {
  var network = new Network()
  var received = []
  var n = 0
  var echo_node = new Node(function (send) {
    return function (msg, addr, port) {
      send(msg, addr, port)
    }
  })
  network.add('1.2.3.4', echo_node)  
  var addr = {address: '1.2.3.4', port:1234}
  var node = new Node(function (send, timer) {
    timer(100, 100, (ts)=>{
      send('hello_'+(++n)+'__'+ts, addr, 1234)
    })
    return function (msg) {
      received.push(msg)
    }
  })
  network.add('5.6.7.8', node)

  network.timer(250, 0, () => {
    node.sleep(true)
  })
  network.timer(750, 0, () => {
    node.sleep(false)
  })

  network.iterateUntil(1000)

  t.deepEqual(received, ['hello_1__100', 'hello_2__200', 'hello_3__800', 'hello_4__900'])

  t.end()

})

test('sleeping while receiving', function (t) {
  var network = new Network()
  var received = []
  var n = 0
  var addr = {address: '5.6.7.8', port:1234}
  var echo_node = new Node(function (send, timer) {
    timer(100, 100, (ts)=>{
      console.log("SEND!", ts)
      send('hello_'+(++n)+'__'+ts, addr, 1234)
    })
    return function (msg, addr, port) {
    }
  })
  network.add('1.2.3.4', echo_node)  
  var node = new Node(function (send, timer) {
    return function (msg) {
      received.push(msg)
    }
  })
  network.add('5.6.7.8', node)

  network.timer(250, 0, () => {
    node.sleep(true)
  })
  network.timer(750, 0, () => {
    node.sleep(false)
  })

  network.iterateUntil(1000)

  t.deepEqual(received, ['hello_1__100', 'hello_2__200', 'hello_8__800', 'hello_9__900'])

  t.end()

})

test('nat timeout', function (t) {
  var network = new Network()
  var received = []
  function EchoNat(network, Nat) {
    var nat = new Nat('5.6.')
    var echo_node = new Node(function (send, timer) {
      return function (msg, addr, port) {
        timer(msg.delay, 0, (ts)=>{
          send({echo: msg}, addr, port)
        })

      }
    })
    var node = new Node(function (send, timer) {
      return function (msg, port, ts) {
        msg.ts = ts
        received.push(msg)
      }
    })
    network.add('1.2.3.4', echo_node)  
    network.add('5.6.7.8', nat)
    nat.add('5.6.7.80', node)
    return [node, nat]
  }
  var [node, nat] = EchoNat(network, IndependentFirewallNat)
  node.send({type:'ping', value: 1, delay: 29_000}, {address:'1.2.3.4', port:1234}, 1234)
  node.send({type:'ping', value: 2, delay: 31_000}, {address:'1.2.3.4', port:1234}, 1234)
  //actually, I think this is wrong now. The firewall should care about the source port.
  node.send({type:'ping', value: 3, delay: 15_000}, {address:'1.2.3.4', port:1235}, 1235)
  node.send({type:'ping', value: 4, delay: 46_000}, {address:'1.2.3.4', port:1235}, 1235)

  network.iterateUntil(60_000)
  console.log(received)
  console.log(nat)
  t.end()
})
