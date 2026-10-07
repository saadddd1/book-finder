// 生成 PWA 图标 (192/512): 靛蓝底 + 白色书本图形, 纯 node 零依赖
const zlib = require('zlib');
const fs = require('fs');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function makeIcon(size, file) {
  const px = Buffer.alloc(size * size * 4);
  const u = size / 512;
  // 背景: 靛蓝 #4f46e5
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = 79; px[i * 4 + 1] = 70; px[i * 4 + 2] = 229; px[i * 4 + 3] = 255;
  }
  // 白色圆角矩形(书) 96,120 -> 416,392, 圆角 28
  const x0 = Math.round(96 * u), y0 = Math.round(120 * u), x1 = Math.round(416 * u), y1 = Math.round(392 * u);
  const rad = Math.round(28 * u);
  const inRounded = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + rad - x, x - (x1 - rad), 0);
    const dy = Math.max(y0 + rad - y, y - (y1 - rad), 0);
    return dx * dx + dy * dy <= rad * rad;
  };
  // 书脊竖线区间(靛蓝)
  const sx0 = Math.round(252 * u), sx1 = Math.round(260 * u);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (inRounded(x, y)) {
      if (x >= sx0 && x <= sx1 && y > y0 + rad && y < y1 - rad) continue; // 书脊露出底色
      const i = (y * size + x) * 4;
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
    }
  }
  // 打包 PNG
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]));
  console.log('written', file);
}

makeIcon(192, 'icon-192.png');
makeIcon(512, 'icon-512.png');
