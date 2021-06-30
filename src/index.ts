import * as net from 'net'
import * as tls from 'tls'
import { get_original_dst } from './sockopt';
import { readFileSync } from 'fs';
import { Transform } from 'stream';

const socks = require('@heroku/socksv5')
const config = require('../config')

let connId = 0;
function proxySockets(csk: net.Socket, addr: string, port: number) {
    let cid = connId++
    let log = console.info
    const tap = (tag: string) => new Transform({
        transform(chunk, encoding, callback) {
            //console.info("CONN[%d] %s %d", cid, tag, chunk.length)
            callback(null, chunk)
        }
    });
    let ctap = csk.pipe(tap('csk'))
    log("CONN[%d | %s:%d] Connection from %s:%d", cid, addr, port, csk.remoteAddress, csk.remotePort)
    function onError(msg: string) {
        log("CONN[%d | %s:%d] Server Connection failed: %s", cid, addr, port, msg)
        csk.end()
        ssk.end()
    }
    function setupPipe(msg: string, chunk: Buffer) {
        log("CONN[%d | %s:%d] %s", cid, addr, port, msg)
        csk.on('error', e => {
            ssk.end()
            log("CONN[%d | %s:%d] Client Error: %O", cid, addr, port, e)
        })
        if (chunk.length) csk.write(chunk)
        ctap.pipe(ssk)
        //let stap = ssk.pipe(tap('ssk'))
        ssk.pipe(csk)
    }
    function handleHttpResp(resp: string[], chunk: Buffer) {
        if (resp[0].match(/^HTTP\/\d\.\d 200/)) {
            setupPipe(resp[0], chunk)
        } else {
            onError(resp[0])
        }
    }
    let resp = new Array<string>()
    let chunk = Buffer.from("");
    function onData(d: Buffer) {
        if (config.upstream.proto == 'connect') {
            chunk = Buffer.concat([chunk, d])
            let pos = d.indexOf('\r\n')
            if (pos >= 0) {
                let line = chunk.slice(0, pos).toString()
                let rest = chunk.slice(pos + 2)
                resp.push(line)
                chunk = Buffer.from("")
                if (line == '') {
                    ssk.removeListener('data', onData)
                    handleHttpResp(resp, rest)
                } else {
                    onData(rest)
                }
            }
        } else {
            ssk.removeListener('data', onData)
            setupPipe("connected", d)
        }
    }
    function connectSocks(): net.Socket {
        return socks.connect({
            host: addr,
            port: port,
            proxyHost: config.upstream.host,
            proxyPort: config.upstream.port,
            auths: [socks.auth.None()]
        })
    }
    function connectHttp(): net.Socket {
        if (config.upstream.tls) {
            return tls.connect({
                host: config.upstream.host,
                port: config.upstream.port,
                cert: readFileSync(config.upstream.certs.crt),
                key: readFileSync(config.upstream.certs.key),
                ca: [readFileSync(config.upstream.certs.ca)],
                checkServerIdentity: () => { return null; },
            }).on('secureConnect', () => {
                log("CONN[%d | %s:%d] Connection to proxy %s:%d", cid, addr, port, ssk.remoteAddress, ssk.remotePort)
                ssk.write(`CONNECT ${addr}:${port} HTTP/1.1\r\n\r\n`)
            })
        } else {
            return net.connect({
                host: config.upstream.host,
                port: config.upstream.port,
            }).on('connect', () => {
                log("CONN[%d | %s:%d] Connection to proxy %s:%d", cid, addr, port, ssk.remoteAddress, ssk.remotePort)
                ssk.write(`CONNECT ${addr}:${port} HTTP/1.1\r\n\r\n`)
            })
        }
    }
    function connect(): net.Socket {
        if (config.upstream.proto == 'connect')
            return connectHttp()
        else
            return connectSocks()
    }
    let ssk = connect()
    ssk.on('error', (e) => {
        csk.end()
        log("CONN[%d | %s:%d] Server Error: %O", cid, addr, port, e)
    }).on('end', () => {
        log("CONN[%d | %s:%d] Connection closed", cid, addr, port)
    }).on('data', onData)
}

const server = net.createServer(csk => {
    let client = get_original_dst(csk)
    proxySockets(csk, client[0], client[1])
})

server.listen(config.listen.tproxy, '0.0.0.0')
console.info(`Listening TProxy on ${config.listen.tproxy}`)

const sockServ = socks.createServer({ debug: console.info }, (info: any, accept: Function, _deny: Function) => {
    let csk = accept(true)
    proxySockets(csk, info.dstAddr, info.dstPort)
})

sockServ.useAuth(socks.auth.UserPassword((_u: any, _p: any, cb: Function) => { cb(true); }));
sockServ.useAuth(socks.auth.None())
sockServ.listen(config.listen.socksv5, '0.0.0.0')
console.info(`Listening SocksV5 on ${config.listen.socksv5}`)
