import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createTarGz, PackageFormatError, readTarGz, sanitizeEntryPath } from "./tar";

function rawTar(name: string, type: string, data = "") {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "latin1");
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "latin1");
  header.write("ustar\0", 257, 6, "latin1");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
  body.write(data);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc(1024, 0)]));
}

describe("Modulpakete (tar.gz)", () => {
  it("liest geschriebene Pakete zurück und entfernt den gemeinsamen Ordner package/", () => {
    const longPath = `package/client/${"a".repeat(80)}/${"b".repeat(60)}.mjs`;
    const archive = createTarGz([
      { path: "package/manifest.json", data: "{}" },
      { path: longPath, data: "x" }
    ]);
    expect(readTarGz(archive).map((entry) => [entry.path, entry.data.toString()])).toEqual([
      ["manifest.json", "{}"],
      [longPath.slice("package/".length), "x"]
    ]);
  });

  it("lehnt Pfade außerhalb des Pakets, absolute Pfade und Symlinks ab", () => {
    expect(() => sanitizeEntryPath("../etc/passwd")).toThrow(PackageFormatError);
    expect(() => sanitizeEntryPath("a/../../x")).toThrow(PackageFormatError);
    expect(() => sanitizeEntryPath("/etc/passwd")).toThrow(PackageFormatError);
    expect(() => sanitizeEntryPath("C:\\x")).toThrow(PackageFormatError);
    expect(sanitizeEntryPath("./a//b/")).toBe("a/b");
    expect(() => readTarGz(rawTar("../evil.mjs", "0", "x"))).toThrow(/außerhalb/);
    expect(() => readTarGz(rawTar("link", "2"))).toThrow(/Nicht erlaubter Eintrag/);
    expect(() => readTarGz(Buffer.from("kein archiv"))).toThrow(/kein gültiges/);
  });

  it("begrenzt Größe und Anzahl der Dateien", () => {
    const archive = createTarGz([
      { path: "manifest.json", data: "{}" },
      { path: "big.bin", data: Buffer.alloc(4096) }
    ]);
    expect(() => readTarGz(archive, { maxUnpackedBytes: 1024 })).toThrow(PackageFormatError);
    expect(() => readTarGz(archive, { maxFiles: 1 })).toThrow(/zu viele/);
  });
});
