
# netsim

netsim deterministically simulates networks for use testing distributed and peer to peer systems.

These are difficult to test, because firstly, packets can get dropped or delivered out of order,
so we need to be able to ensure that code has the correct behavior irrespective of message reliability or ordering.

And secondly, because the network is complicated and it's behavior depends on many aspects of configuration
that are not easily reproducable -- such as using different styles of Network Address Translation (NAT)
This avoids neeeding to coordinate a large number of test devices, and more importantly, a test network,
and makes it possible to introduce failures _intensionally_ so they that behavior can be tested in those cases.

This module does not replicate the entire os level networking interface, but if you write code using it's patterns it can produce a lightweight simulation. So far, `netsim` is being used to write tests for [`introducer`](https://github.com/socketsupply/introducer/)

it focuses specifially on dgram, modelling tcp is not currently planned.

## api

### node = new Node ()

a node represents a peer/device on the network.

#### node.send(msg, {address, port}, send_port)

send `msg` to `{address, port}` from `send_port`.

(note, dgram usually requires "binding" the port, but this detail is simply rolled into specifying the
port to send from. The "birthday paradox NAT traversal" technique requires sending packets from and to many ports,
so this interface simplifies that)


#### node.timer(delay=0, repeat=0, fn=(ts) => boolean)

call a function later. it's usually necessary to use timers and delays, to for example, deal with latency,
so these need to be modelable. 

if `repeat` is non zero, the function `ft` is called repeatedly every `repeat` (simulated) ms.
if `delay` is non zero, the first call of `fn` is delayed. If `delay` is non-zero, but `repeat` is zero,
then `fn` is called after the delay, but not again.

if `fn` returns `false` the repeating interval is cancelled, `fn` will not be called again.

#### node.sleep (isSLeeping=boolean)

used to simulate nodes suspending/power down.

true=suspend the node. any incoming packets are ignored, and any timers are delayed until wake up.
false=wakeup from sleep. timers will now be called. new messages will now be received.

any messages sent to a peer while sleeping are dropped.

### network = new Network()

a simulated network of nodes.

#### network.add(address, node | nat)

adds a node to this network. other nodes in this network will now be able to send packets to this node.
a node may only be in a single network at a time.

the `node` can also be a subnetwork `nat`. [see below](#nat)

#### network.remove(node)

remove node from this network.

#### iterateUntil(until_ts)

run the network simulation until time `until_ts`. a newly Network will start at time 0.

#### iterate(steps)

run the network simulation a fixed number of steps, or until there are no more steps.
if `step = -1` then will not stop until there are events to run.
If the simulation contains repeating timers it this will cause it to run for every,
so use `iterateUntil` in that case.

### nat = new Nat(prefix)

Creates a simulated local network, with Network Address Translation.
NAT comes in a number of different flavors.

* DependentNat - a "hard" nat that assigns ports randomly for different hosts
* IndependentFirewallNat - an "easy" nat that randomly assigns ports, but allows different hosts to communicate via the same port, so it's easy to receive connections. Because of the firewall, the send/receive peer must coordinate to establish a connection.
* IndependentNat - assigns ports but does not use a firewall, so a peer on this nat can receive connections.

#### nat.add(address, node)

adds a node to this subnetwork. `address` must match the `prefix` passed to the Nat constructor.

#### nat.remove(node)

inherited from `network.remove`

#### nat.TTL = 30_000

time that a port mapping on a firewall nat remains open.
I tried several nats (that I had on hand) and found 30 seconds to be the lowest time they stayed open, so I set the default time to that.

