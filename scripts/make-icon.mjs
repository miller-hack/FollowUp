// Draws the FollowUp icon (purple disc + white check, same as the tray icon) and writes
// build/icon.png (512px) and build/icon.ico (16–256px, PNG-compressed) for the installer.
// Usage: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const c = size / 2
  const r = size / 2 - 0.5
  const segs = [
    [0.28, 0.52, 0.44, 0.68],
    [0.44, 0.68, 0.73, 0.36]
  ]
  const thick = size * 0.075
  const dist = (x, y, [x1, y1, x2, y2]) => {
    const [ax, ay, bx, by] = [x1 * size, y1 * size, x2 * size, y2 * size]
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)))
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5
      const cy = y + 0.5
      const disc = Math.max(0, Math.min(1, r - Math.hypot(cx - c, cy - c) + 0.5))
      const check = Math.max(0, Math.min(1, thick - Math.min(...segs.map((s) => dist(cx, cy, s))) + 0.5))
      const i = (y * size + x) * 4
      // RGBA: #7b68ee blended toward white by the check coverage
      px[i] = Math.round(0x7b + (0xff - 0x7b) * check)
      px[i + 1] = Math.round(0x68 + (0xff - 0x68) * check)
      px[i + 2] = Math.round(0xee + (0xff - 0xee) * check)
      px[i + 3] = Math.round(255 * disc)
    }
  }
  return px
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size) {
  const px = draw(size)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4) // filter byte 0
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function ico(sizes) {
  const images = sizes.map(png)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // icon
  header.writeUInt16LE(sizes.length, 4)
  const dir = Buffer.alloc(16 * sizes.length)
  let offset = 6 + dir.length
  sizes.forEach((s, i) => {
    const e = i * 16
    dir[e] = s >= 256 ? 0 : s
    dir[e + 1] = s >= 256 ? 0 : s
    dir.writeUInt16LE(1, e + 4) // planes
    dir.writeUInt16LE(32, e + 6) // bpp
    dir.writeUInt32LE(images[i].length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, dir, ...images])
}

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png(512))
writeFileSync('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]))
console.log('wrote build/icon.png and build/icon.ico')
