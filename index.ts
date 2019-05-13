import * as net from 'net'
import * as tls from 'tls'
import { get_original_dst } from './sockopt';
import { readSync, readFileSync } from 'fs';
import { debuglog } from 'util';

let connId=0;
const server = net.createServer(csk => {
    let cid=connId++
    let log=debuglog("conn-"+cid)
    let client = get_original_dst(csk)
    log("Connection from %s:%d, to %s:%d", csk.remoteAddress, csk.remotePort, client[0], client[1])
    let ssk = tls.connect({
        host: 'mirrors-cn.huobi.cn',
        port: 8444,
        cert: readFileSync('certs/proxy.crt'),
        key: readFileSync('certs/proxy.key'),
        ca: [readFileSync('certs/ca.crt')],
        checkServerIdentity: () => { return null; },
    }).on('secureConnect', () => {
        log("Connection to proxy %s:%d", ssk.remoteAddress, ssk.remotePort)
        ssk.write(`CONNECT ${client[0]}:${client[1]} HTTP/1.1\r\n\r\n`)
    }).on('error',(e)=>{
        csk.end()
        log("Error: %O",e)
    }).on('end',()=>{
        log("Connection closed")
    })
    function handleResp(resp: string[], chunk: Buffer) {
        //console.info(resp,chunk)
        if (resp[0].match(/^HTTP\/\d\.\d 200/)) {
            if(chunk.length)csk.write(chunk)
            csk.pipe(ssk)
            ssk.pipe(csk)
            csk.on('error',e=>{
                ssk.end()
                log("Error: %O",e)
            })
        } else {
            csk.end()
            ssk.end()
        }
    }
    ssk.once('data', (data) => {
        let resp = new Array<string>()
        let chunk = Buffer.from("");
        function onData(d: Buffer) {
            chunk = Buffer.concat([chunk, d])
            let pos = d.indexOf('\r\n')
            if (pos >= 0) {
                let line = chunk.slice(0, pos).toString()
                let rest = chunk.slice(pos + 2)
                resp.push(line)
                chunk = Buffer.from("")
                if (line == '') {
                    handleResp(resp, rest)
                } else {
                    onData(rest)
                }
            } else {
                ssk.once('data', onData)
            }
        }
        onData(data)
    })
})

server.listen(12345)

