const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generateCod4Key(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const chars = Array.from(bytes, (b) => CHARSET[b % CHARSET.length]);

  // XOR-fold checksum: 8 rounds over pairs of key chars
  let acc = 0;
  for (let i = 0; i < 8; i++) {
    acc ^= chars[i * 2].charCodeAt(0) | (chars[i * 2 + 1].charCodeAt(0) << 8);
  }
  acc ^= 0x14002;
  const checksum = (acc & 0xffff).toString(16).toUpperCase().padStart(4, "0");

  const g1 = chars.slice(0, 4).join("");
  const g2 = chars.slice(4, 8).join("");
  const g3 = chars.slice(8, 12).join("");
  const g4 = chars.slice(12, 16).join("");

  return `${g1}-${g2}-${g3}-${g4}-${checksum}`;
}
