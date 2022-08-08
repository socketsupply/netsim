var Heap = require('heap')
//var heap = new Heap()

function assertAddress (addr, name='addr') {
  if(!isPort(addr.port) && 'string' === typeof addr.address)
    throw new Error(addr+' *must* be {address, port} object')
}

function isPort (p) {
  return p === (p & 0xffff)
}

function noop () {}

// this code works, but I'm not really very happy with it.
// I'd rather have a simple datastructure rather than OO & inheritance
// OO seems to send it self to an ugly mess

function toAddress (a) {
  return a.address+':'+a.port
}

class Node {
  network = null;
  constructor (fn) {
    if(fn)
      this.init = ()=>{
        this.onMessage = fn(this.send.bind(this), this.network.timer.bind(this.network), this)
      }
  }
  send (msg, addr, port) {
    if(!isPort(port)) throw new Error('must provide source port')
    this.network.send(msg, addr, port, this)
  }
}

function cmp_ts (a, b) {
  return a.ts - b.ts
}

function calcLatency (s,d) {
  return (s.ts||0) + Math.random()
}

class Network extends Node {
  subnet = null
  inited = false
  constructor (prefix) {
    super()
    this.prefix = prefix
    this.subnet = {}
    this.map = {}
    this.unmap = {}
    this.heap = new Heap(cmp_ts)
  }
  add (address, node) {
    if(this.prefix && !address.startsWith(this.prefix)) throw new Error('subnet address must start with prefix:'+this.prefix+', got:'+address)
    this.subnet[address] = node
    node.network = this
    node.address = address
    //if the node is a nat, share our heap with it
    if(node.subnet) node.heap = this.heap
  }
  send (msg, addr, port, source) {
    assertAddress(addr)
    if(!source) throw new Error('must provide source')
    var dest = this.subnet[addr.address]
    var _addr = {address:source.address, port}
    if(dest) {
      var ts = calcLatency(source, dest)
      source.ts = ts
      this.heap.push({ts, fn: () => {
        var s = JSON.stringify(msg)
        if(s.length > 23) s = s.substring(0, 20) + '...' 
        console.log('MSG', toAddress({address:source.address, port})+'->'+toAddress(addr), s) 
        dest.onMessage(msg, _addr, addr.port)
      }})
    }
    else
      this.drop(msg, addr, port, source)
  }
  init () {
    if(this.inited) return
    this.inited = true
    for(var k in this.subnet)
      this.subnet[k].init()
  }
  iterate (steps) {
    this.init()
    while(steps-- && this.heap.size()) {
      var k = this.heap.pop()
      if(!k) return;
      k.fn(k.ts)
    }
  }
  timer (delay, repeat, fn) {
    if(!repeat)
      this.heap.push({ts: this.ts + delay, fn: fn})
    else {
      var self = this
      this.heap.push({ts: this.ts + delay, fn: function next () {
        if(fn() !== false)
          self.heap.push({ts: self.ts + repeat, fn: next})
      }})
    }      

  }
  drop (msg, addr) {
    throw new Error('cannot send to outside address:'+JSON.stringify(addr))
  }
  //msg, from, to
  onMessage ({msg, addr, port}) {
    throw new Error('cannot receive message')
  }
}

//endpoint independent nat - maps based on sender port.
class Nat extends Network {
  subnet = null
  constructor (prefix) {
    super()
    this.prefix = prefix || ''
    this.subnet = {}
    this.map = {}
    this.unmap = {}
  }
  add (address, node) {
    if(!address.startsWith(this.prefix))
      throw new Error('node address must start with prefix:'+this.prefix+', got:'+address)
    node.localAddress = address
    super.add(address, node)
    //this.subnet[address] = node
  }
  getPort () {
    this.ports = this.ports || {}
    var r
    while(this.ports[r = ~~(Math.random()*0xffff)]);
    this.ports[r] = true 
    return r
  }
  addFirewall () {

  }
  getFirewall (addr) {
    return true
  }
  //subclasses must implement getKey
  drop (msg, dst, port, source) {
    if(dst.address === this.address) {
      //drop message if we do not support hairpinning
      if(!this.hairpinning) return
    }
    var key = this.getKey(dst, {address:source.address, port: port})
    var _port = this.map[key]
    if(!_port) {
      _port = this.getPort()
      this.map[key] = _port
      this.unmap[_port] = {address: source.address, port}
    }
    this.addFirewall(dst)
    this.network.send(msg, dst, _port, this)
  }
  //msg, from, to
  onMessage (msg, addr, port) {
    //network has received an entire packet
    if(!this.getFirewall(addr)) {
      return
    }
    var dst = this.unmap[port]

    if(dst) //TODO model this as another send
      this.subnet[dst.address].onMessage(msg, addr, dst.port)
  }
}

class IndependentNat extends Nat {
  constructor () {
    super()
    this.hairpinning = true
  }
  getKey (dst, src) {
    return src.address+':'+src.port
  }
}

class IndependentFirewallNat extends Nat {
  constructor (prefix) {
    super(prefix)
    this.hairpinning = true
    this.firewall = {}
  }
  getKey (dst, src) {
    return src.address+':'+src.port
  }
  addFirewall(addr) {
    this.firewall[addr.address+':'+addr.port] = true
  }
  getFirewall(addr) {
    return !!this.firewall[addr.address+':'+addr.port]
  }
}

//since a dependant nat always changes ports for different hosts
//it acts like it's a firewall and a nat combined.
class DependentNat extends Nat {
  constructor (prefix) {
    super(prefix)
    this.firewall = {}
  }
  getKey (dst, src) {
    return dst.address+':'+dst.port+'->'+src.address+':'+src.port
  }
  addFirewall(addr) {
    this.firewall[addr.address+':'+addr.port] = true
  }
  getFirewall(addr) {
    return !!this.firewall[addr.address+':'+addr.port]
  }
}

module.exports = {Node, Network, IndependentNat, IndependentFirewallNat, DependentNat}
