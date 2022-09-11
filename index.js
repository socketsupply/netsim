var TsQueue = require('./ts-queue')

function assertAddress (addr, name='addr') {
  if(!isPort(addr.port) && 'string' !== typeof addr.address)
    throw new Error(name+' *must* be {address, port} object, was:'+JSON.stringify(addr))
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
      this.init = (ts)=>{
        this.onMessage = fn(this.send.bind(this), this.timer.bind(this), this, ts)
      }
  }
  send (msg, addr, port) {
    assertAddress(addr)
    if(!isPort(port)) throw new Error('must provide source port')
    if(this.network && !this.sleeping)
      this.network.send(msg, addr, port, this)
    //else if offline, just drop messages
  }
  timer (delay, repeat, fn) {
    this.network.timer(delay, repeat, (ts)=>{
      if(this.sleeping) {
        if(repeat) return
        if(delay) throw new Error('sleeping during a delay only timer is not supported')
      }
      return fn(ts)
    })
  }
  sleep (sleeping) {
    this.sleeping = sleeping === true
  }
}

function calcLatency (s,d) {
  return Math.random()
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
    this.queue = new TsQueue()
  }
  add (address, node) {
    if(this.prefix && !address.startsWith(this.prefix)) throw new Error('subnet address must start with prefix:'+this.prefix+', got:'+address)

    if(node.network) {
      node.network.remove(node)
    }
    this.subnet[address] = node
    node.network = this
    node.address = address
    //if the node is a nat, share our heap with it
    if(!node.inited) {
      node.inited = true
      node.init(this.queue.ts)
    }
    if(node.subnet) node.queue = this.queue
  }
  remove (node) {
    if(!node.network === this) return
    if(this.subnet[node.address] !== node) throw new Error("invalid network->node relationship.\n node's address does not agree with network's map")
    delete this.subnet[node.address]
    node.network = null
    node.address = null
  }
  send (msg, addr, port, source) {
    assertAddress(addr)
    if(!source) throw new Error('must provide source')
    var dest = this.subnet[addr.address]
    var _addr = {address:source.address, port}
    if(dest) {
      this.queue.delay(calcLatency(source, dest), (ts) => {
        var s = JSON.stringify(msg)
        if(s.length > 23) s = s.substring(0, 20) + '...' 
        console.log('MSG', toAddress({address:source.address, port})+'->'+toAddress(addr), s, ts)
        if(!dest.sleeping)
          dest.onMessage(msg, _addr, addr.port, ts)
      })
    }
    else
      this.drop(msg, addr, port, source)
  }
  init () {
    console.log("INIT?", this.subnet)
    for(var k in this.subnet) {
      if(!this.subnet[k].inited) {
        this.subnet[k].inited = true
        this.subnet[k].init(0)
      }
    }
  }
  iterate (steps) {
    this.init()
    this.queue.drainSteps(steps)
  }
  iterateUntil (until_ts) {
    this.init()
    this.queue.drain(until_ts)
  }
/*  delay (wait, fn) {
    if(wait <= 0) throw new Error('delay must be positive, was:'+wait)
    this.queue.delay(wait, fn)
  }*/
  timer (delay, repeat, fn) {
    this.queue.timer(delay, repeat, fn)
  }
  drop (msg, addr) {
    throw new Error('cannot send to outside address:'+JSON.stringify(addr))
  }
  //msg, from, to
  onMessage (msg, addr, port, ts) {
    throw new Error('cannot receive message')
  }
}

//endpoint independent nat - maps based on sender port.
class Nat extends Network {
  subnet = null
  constructor (prefix) {
    super()
    this.TTL = 30_000
    this.prefix = prefix || ''
    this.subnet = {}
    this.map = {}
    this.unmap = {}
  }
  add (address, node) {
    if(!address.startsWith(this.prefix))
      throw new Error('node address must start with prefix:'+this.prefix+', got:'+address)

    super.add(address, node)
    //node.address = address
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
    //returns the current time, same effect as always letting it through
    return this.queue.ts || 1
  }
  //subclasses must implement getKey
  drop (msg, dst, port, source, ts) {
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
    this.addFirewall(dst, _port, this.queue.ts || 1)
    this.network.send(msg, dst, _port, this)
  }
  //msg, from, to
  onMessage (msg, addr, port, ts) {
    //network has received an entire packet
    var fw = this.getFirewall(addr, port)
    if(fw == null || fw + this.TTL < ts) {
      return
    }
    else //received messages, with open firewall, extend the TTL
      this.addFirewall(addr, port, ts)

    var dst = this.unmap[port]

    if(dst && this.subnet[dst.address] && !this.subnet[dst.address].sleeping) //TODO model this as another send
      this.subnet[dst.address].onMessage(msg, addr, dst.port, ts)
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
  addFirewall(addr, port, ts) {
    this.firewall[addr.address+':'+addr.port+':'+port] = ts
  }
  getFirewall(addr, port) {
    return this.firewall[addr.address+':'+addr.port+':'+port]
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
  addFirewall(addr, port, ts) {
    this.firewall[addr.address+':'+addr.port] = ts
  }
  getFirewall(addr, port) {
    return this.firewall[addr.address+':'+addr.port]
  }
}

module.exports = {Node, Network, IndependentNat, IndependentFirewallNat, DependentNat}
