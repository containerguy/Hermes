import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCredentialFile } from "./s3-storage";

let credentialFile: string | undefined;

function writeCredentials(content: string) {
  credentialFile = path.join(os.tmpdir(), `hermes-s3-creds-${randomUUID()}`);
  fs.writeFileSync(credentialFile, content);
  return credentialFile;
}

describe("s3 credential file parser", () => {
  afterEach(() => {
    if (credentialFile) {
      fs.rmSync(credentialFile, { force: true });
      credentialFile = undefined;
    }
  });

  it("supports Wasabi-style hyphenated keys", () => {
    const parsed = readCredentialFile(
      writeCredentials("access-key=access-value\nsecret-key=secret-value\n")
    );

    expect(parsed).toEqual({
      accessKeyId: "access-value",
      secretAccessKey: "secret-value"
    });
  });

  it("supports AWS-style keys", () => {
    const parsed = readCredentialFile(
      writeCredentials("AWS_ACCESS_KEY_ID=access-value\nAWS_SECRET_ACCESS_KEY=secret-value\n")
    );

    expect(parsed.accessKeyId).toBe("access-value");
    expect(parsed.secretAccessKey).toBe("secret-value");
  });

  it("supports two bare lines", () => {
    const parsed = readCredentialFile(writeCredentials("access-value\nsecret-value\n"));

    expect(parsed.accessKeyId).toBe("access-value");
    expect(parsed.secretAccessKey).toBe("secret-value");
  });
});
