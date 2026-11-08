import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { decodePVR } from '../src/platform/pvr.js';
function crc32(buf){let c,crc=0xffffffff;for(let n=0;n<buf.length;n++){c=(crc^buf[n])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
export function png(w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(rgba.buffer,rgba.byteOffset+y*w*4,w*4).copy(raw,y*(w*4+1)+1);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const [,,inDir,outDir]=process.argv;
for (const f of fs.readdirSync(inDir).filter(f=>f.endsWith('.pvr'))) { const t=Date.now(); const r=decodePVR(new Uint8Array(fs.readFileSync(path.join(inDir,f)))); fs.writeFileSync(path.join(outDir,f+'.png'),png(r.width,r.height,r.rgba)); console.log(f,r.width,r.height,Date.now()-t,'ms'); }
