import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UT2004_PROTOCOL_REG, UT2004_PROTOCOL_REMOVE_REG } from "./connect-link";

/** Die .reg-Dateien werden aus `public/` statisch ausgeliefert; regedit verlangt UTF-16LE mit BOM und CRLF. */
function readReg(urlPath: string) {
  const bytes = fs.readFileSync(path.join(process.cwd(), "public", urlPath));
  expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
  return bytes.subarray(2).toString("utf16le");
}

describe("UT2004 protocol .reg downloads", () => {
  it("registers ut2004:// machine-wide for the GOG install path", () => {
    const text = readReg(UT2004_PROTOCOL_REG);
    expect(text.startsWith("Windows Registry Editor Version 5.00\r\n\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    // HKCU-Protokolle nimmt Windows 11 aus Explorer und Browser nicht an
    expect(text).not.toContain("HKEY_CURRENT_USER");
    expect(text).toContain('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\ut2004]\r\n@="URL:Unreal Tournament 2004"\r\n"URL Protocol"=""');
    expect(text).toContain(
      '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\ut2004\\shell\\open\\command]\r\n' +
        '@="\\"C:\\\\Program Files (x86)\\\\GOG.com\\\\Unreal Tournament 2004\\\\System\\\\UT2004.exe\\" \\"%1\\""\r\n'
    );
  });

  it("removes the ut2004 protocol key again", () => {
    const text = readReg(UT2004_PROTOCOL_REMOVE_REG);
    expect(text).toBe("Windows Registry Editor Version 5.00\r\n\r\n[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\ut2004]\r\n");
  });
});
