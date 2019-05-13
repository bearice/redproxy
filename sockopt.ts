import * as FFI from 'ffi';
import * as StructType from 'ref-struct';
import * as Ref from 'ref';
import { Socket } from 'net';

const lib = FFI.Library(null, {
  'getsockopt': [ 'int', [ 'int', 'int', 'int', 'pointer', 'pointer']],
  'ntohs': ['uint16', ['uint16']],
});

const SOL_IP = 0
const SOL_TCP =6
const SOL_UDP = 17

const SO_ORIGINAL_DST = 80
const AF_INET = 2

const sockaddr_in = StructType([
    ['int16', 'sin_family'],
    ['uint16', 'sin_port'],
    ['uint32', 'sin_addr'],
    ['uint32', 'trash1'],
    ['uint32', 'trash2'],
]);

export function get_original_dst(client: Socket) : [string,number]{
    let dst = new sockaddr_in
    let dstlen = Ref.alloc(Ref.types.int, sockaddr_in.size);
    let r = lib.getsockopt((client as any)._handle.fd, SOL_IP, SO_ORIGINAL_DST, dst.ref(), dstlen);
    if (r === -1)
        throw new Error("getsockopt(SO_ORIGINAL_DST) error");
    if (dst.sin_family !== AF_INET)
        throw new Error("getsockopt(SO_ORIGINAL_DST) returns unknown family: " + dst.sin_family );
    let ipaddr : Buffer = dst.ref()
    let ipstr = ipaddr[4] + "." + ipaddr[5] + "." + ipaddr[6] + "." + ipaddr[7]
    return [ipstr, lib.ntohs(dst.sin_port)];
}
