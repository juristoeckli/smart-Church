import {connect} from 'node:net';
import {randomBytes} from 'node:crypto';
export async function controlClient(address,path,origin=address) {
 const url=new URL(address),messages=[];let buffer=Buffer.alloc(0),upgraded=false,status='';
 const socket=connect({host:url.hostname,port:Number(url.port)});
 socket.on('error',()=>{});
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.destroy();reject(Error('WebSocket handshake timed out'));},3000);
  socket.once('connect',()=>socket.write(`GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`));
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   if(!upgraded){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;status=buffer.subarray(0,end).toString().split('\r\n')[0];buffer=buffer.subarray(end+4);clearTimeout(timer);resolve();if(!status.includes('101'))return;upgraded=true;}
   while(buffer.length>=2){let length=buffer[1]&127,offset=2;if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}if(length===127)throw Error('Unexpected large test frame');if(buffer.length<offset+length)return;const opcode=buffer[0]&15,payload=buffer.subarray(offset,offset+length);buffer=buffer.subarray(offset+length);if(opcode===1)messages.push(JSON.parse(payload.toString()));}
  });
 });
 await ready;
 return {socket,status,messages,async wait(topic){const until=Date.now()+3000;while(Date.now()<until){const message=messages.find(item=>item.topic===topic);if(message)return message;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Missing WebSocket event '+topic);}};
}
