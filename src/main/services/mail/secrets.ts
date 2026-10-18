/**
 * Secret encoding. The desktop runtime installs Electron safeStorage (Windows DPAPI);
 * outside Electron (unit tests) a reversible base64 codec is used.
 */
interface Codec {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

let codec: Codec = {
  encrypt: (p) => `b64:${Buffer.from(p, 'utf8').toString('base64')}`,
  decrypt: (s) => (s.startsWith('b64:') ? Buffer.from(s.slice(4), 'base64').toString('utf8') : '')
}

export function setSecretCodec(c: Codec): void {
  codec = c
}

export const encryptSecret = (plain: string): string => (plain ? codec.encrypt(plain) : '')
export const decryptSecret = (stored: string): string => (stored ? codec.decrypt(stored) : '')
