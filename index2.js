var Heap = require('heap')
var heap = new Heap()

/*
var network = {
  <ip>: {
    send: [{msg, addr}...],
    recv: [{msg, addr, port}],
  }
}
*/

function noop () {}

class Node {
//  send = null;
//  recv = null;
  network = null;
  constructor (fn) {
    if(fn)
      this.init = ()=>{
        this.onMessage = fn(this.send.bind(this))
      }
  }
  send (msg, addr, port) {
    this.network.send(msg, addr, port, this)
  }
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
  }
  add (address, node) {
    this.subnet[address] = node
    node.network = this
    node.address = address
  }
  send (msg, addr, port, source) {
    if(!source) throw new Error('must provide source')
    var dest = this.subnet[addr.address]
    var _addr = {address:source.address, port}
    if(dest) {
      var ts = calcLatency(source, dest)
      source.ts = ts
//      heap.push({msg, {address:source.address, port: port}, port:addr.port, target: dest})
      heap.push({ts, fn: () => {
        console.log(_addr, '->', addr, msg)
        dest.onMessage(msg, _addr, addr.port)
      }})
//      heap.push({ts: msg,, port:addr.port, target: dest})
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
    while(steps-- && heap.size()) {
      var k = heap.pop()
      if(!k) return;
      k.fn(k.ts)
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
    //console.log("SORUCE", source)
    var key = this.getKey(dst, {address:source.address, port: port})
    var _port = this.map[key]
    console.log("MAPPED?", key, _port)
    if(!_port) {
      _port = this.getPort()
      this.map[key] = _port
      this.unmap[_port] = {address: source.address, port}
      console.log('newmap', this.map, this.unmap)
    }
    this.addFirewall(dst)
    console.log('map', dst, port, _port)
    //console.log("SEND******", msg, dst, port, this)
    this.network.send(msg, dst, _port, this)
  }
  //msg, from, to
  onMessage (msg, addr, port) {
    console.log("NAT_OM", msg, addr, port)
    //network has received an entire packet
    if(!this.getFirewall(addr)) {
//      console.log("FW!", addr)

      return
    }

    var dst = this.unmap[port]
    console.log(dst)
    if(dst)
      this.subnet[dst.address].onMessage(msg, addr, dst.port)
    else
      console.log('no receiver', dst, port)
  }
}

class IndependentNat extends Nat {
  getKey (dst, src) {
    return src.address+':'+src.port
  }
}

class IndependentFirewallNat extends Nat {
  constructor (prefix) {
    super(prefix)
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
    return dst.address+':'+dst.port+'->'+src.port
  }
  addFirewall(addr) {
    this.firewall[addr.address+':'+addr.port] = true
  }
  getFirewall(addr) {
    return !!this.firewall[addr.address+':'+addr.port]
  }
}

//iterate the network. steps=1 to do one set of message passes, -1 to run to completion

//XXX a better approach here would be to use a heap (sorted queue) to order events
//    with random sort values it would be possible to sample search of all possible orderings
function iterate (subnet, drop, steps) {
  throw new Error('not used')
  if(!subnet) throw new Error('iterate *must* be passed `network`')
  if(isNaN(steps)) throw new Error('steps must be number, use -1 to run til completion')
  while(steps--) {
    var changed = false
    for(var ip in subnet) {
      var node = subnet[ip]
      if(node.send.length) {
        var packet = node.send.shift()
        changed = true
        var dest = subnet[packet.addr.address]
        if(dest) {
          //dest.recv.push({msg:packet.msg, addr: {address: ip, port: packet.port}, port: packet.addr.port})
          dest.onMessage(packet.msg, {address: ip, port: packet.port}, packet.addr.port)
        }
        else
          //{msg, addr: to, port: from}
          drop(packet.msg, packet.addr, {address: ip, port: packet.port})
      }
    }
/*
    for(var ip in subnet) {
      var node = subnet[ip]
      if(node.recv.length && node.onMessage) {
        changed = true
        var packet = node.recv.shift()
        node.onMessage(packet.msg, packet.addr, packet.port)
      }
    }
  */
    for(var ip in subnet) {
      var node = subnet[ip]
      if(node.subnet)
        changed = node.iterate(1) || changed

    }
    
    if(!changed) break;
  }
  return changed
}

module.exports = {iterate, Node, Network, IndependentNat, IndependentFirewallNat, DependentNat}
