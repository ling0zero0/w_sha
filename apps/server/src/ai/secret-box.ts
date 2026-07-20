import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const algorithm = "aes-256-gcm";
const keyLength = 32;
const nonceLength = 12;

export interface EncryptedSecret {
  version: 1;
  keyVersion: number;
  ciphertext: string;
  nonce: string;
  authTag: string;
}

export interface SecretBox {
  seal(purpose: string, plaintext: string): EncryptedSecret;
  open(purpose: string, encrypted: EncryptedSecret): string;
}

export class AesGcmSecretBox implements SecretBox {
  private readonly key: Buffer;
  private readonly keyVersion: number;

  constructor(key: Uint8Array, keyVersion = 1) {
    if (key.byteLength !== keyLength) {
      throw new Error("AI master key must contain exactly 32 bytes");
    }
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
      throw new Error("AI master key version must be a positive integer");
    }
    this.key = Buffer.from(key);
    this.keyVersion = keyVersion;
  }

  static fromBase64(encodedKey: string, keyVersion = 1): AesGcmSecretBox {
    const key = Buffer.from(encodedKey, "base64");
    if (key.toString("base64") !== encodedKey) {
      throw new Error("AI master key must be canonical base64");
    }
    return new AesGcmSecretBox(key, keyVersion);
  }

  seal(purpose: string, plaintext: string): EncryptedSecret {
    const additionalData = purposeBuffer(purpose);
    const nonce = randomBytes(nonceLength);
    const cipher = createCipheriv(algorithm, this.key, nonce);
    cipher.setAAD(additionalData);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);

    return {
      version: 1,
      keyVersion: this.keyVersion,
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64")
    };
  }

  open(purpose: string, encrypted: EncryptedSecret): string {
    try {
      if (encrypted.version !== 1 || encrypted.keyVersion !== this.keyVersion) {
        throw new Error("unsupported encrypted secret version");
      }
      const decipher = createDecipheriv(
        algorithm,
        this.key,
        decodeBase64(encrypted.nonce, nonceLength)
      );
      decipher.setAAD(purposeBuffer(purpose));
      decipher.setAuthTag(decodeBase64(encrypted.authTag, 16));
      return Buffer.concat([
        decipher.update(decodeBase64(encrypted.ciphertext)),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw new Error("could not decrypt AI credential");
    }
  }
}

function purposeBuffer(purpose: string): Buffer {
  if (!purpose.trim()) throw new Error("secret purpose must not be empty");
  return Buffer.from(purpose, "utf8");
}

function decodeBase64(value: string, expectedLength?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value
    || (expectedLength !== undefined && decoded.byteLength !== expectedLength)
  ) {
    throw new Error("invalid encrypted secret encoding");
  }
  return decoded;
}
