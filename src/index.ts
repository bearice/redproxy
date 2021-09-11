import * as net from 'net'
import * as tls from 'tls'
import { get_original_dst } from './sockopt';
import { readFileSync } from 'fs';
import { Transform } from 'stream';

const util = require('util')
const socks = require('@heroku/socksv5')
const config = require('../config')

let connId = 0;
function proxySockets(csk: net.Socket, addr: string, port: number) {
    let cid = connId++
    let log = function (raw: string, ...args: any[]) {
        let msg = util.format(raw, ...args)
        console.log("CONN[p=%s n=%d s=%s:%d t=%s:%d] %s",
            process.argv[2] || 'default',
            cid,
            csk.remoteAddress, csk.remotePort,
            addr, port,
            msg)
    }
    const tap = (tag: string) => new Transform({
        transform(chunk, encoding, callback) {
            //console.info("CONN[%d] %s %d", cid, tag, chunk.length)
            callback(null, chunk)
        }
    });
    let ctap = csk.pipe(tap('csk'))
    log("Connection from %s:%d", csk.remoteAddress, csk.remotePort)
    function onError(msg: string) {
        log("Server Connection failed: %s", msg)
        csk.end()
        ssk.end()
    }
    function setupPipe(msg: string, chunk: Buffer) {
        log("Server response: %s", msg)
        csk.on('error', e => {
            ssk.end()
            log("Client Error: %O", e)
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
                log("Connection to proxy %s:%d", ssk.remoteAddress, ssk.remotePort)
                ssk.write(`CONNECT ${addr}:${port} HTTP/1.1\r\n\r\n`)
            })
        } else {
            return net.connect({
                host: config.upstream.host,
                port: config.upstream.port,
            }).on('connect', () => {
                log("Connection to proxy %s:%d", ssk.remoteAddress, ssk.remotePort)
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
        log("Server Error: %O", e)
    }).on('end', () => {
        log("Connection closed")
    }).on('data', onData)
}

const server = net.createServer(csk => {
    let client = get_original_dst(csk)
    proxySockets(csk, client[0], client[1])
})

function parse_bind_addr(s: any): any {
    let host = "0.0.0.0"
    let port = 0
    if (typeof (s) == 'number') {
        port = s
    } else {
        let t = s.split(":")
        host = t[0]
        port = parseInt(t[1])
    }
    return { host, port }
}

if (config.listen.tproxy) {
    let listen = parse_bind_addr(config.listen.tproxy)
    server.listen(listen.port, listen.host)
    console.info(`Listening TProxy on ${listen.host}:${listen.port}`)
}

if (config.listen.socksv5) {
    const sockServ = socks.createServer({ debug: console.info }, (info: any, accept: Function, _deny: Function) => {
        let csk = accept(true)
        proxySockets(csk, info.dstAddr, info.dstPort)
    })

    sockServ.useAuth(socks.auth.UserPassword((_u: any, _p: any, cb: Function) => { cb(true); }));
    sockServ.useAuth(socks.auth.None())

    let listen = parse_bind_addr(config.listen.socksv5)
    sockServ.listen(listen.port, listen.host)
    console.info(`Listening SocksV5 on ${listen.host}:${listen.port}`)
}