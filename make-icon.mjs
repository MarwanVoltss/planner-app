import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Minimal PNG encoder (RGBA, no filters) for our neon icon.
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeIcon(size) {
  const px = [];
  const S = size;
  const edge = Math.max(1, Math.round(S * 0.13));
  const inc = (x, y) => {
    const d = Math.hypot(x - S / 2, y - S / 2);
    const r = S / 2 - edge;
    return d <= r;
  };
  // ring color (neon purple->cyan gradient by x)
  for (let y = 0; y < S; y++) {
    px.push(Buffer.from([0])); // filter none
    for (let x = 0; x < S; x++) {
      const on = inc(x, y);
      const bg = Math.floor(14 * (1 - y / S) + 8 * (y / S));
      let r, g, b;
      r = on ? (18 + Math.floor(x / S * 200)) : bg;
      g = on ? (220 - Math.floor(x / S * 60)) : bg;
      b = on ? 255 : bg + 4;
      px.push(Buffer.from([r, g, b, 255]));
    }
  }
  const raw = Buffer.concat(px);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(new URL('./public/icon-192.png', import.meta.url), makeIcon(192));
writeFileSync(new URL('./public/icon-512.png', import.meta.url), makeIcon(512));
console.log('icons written');