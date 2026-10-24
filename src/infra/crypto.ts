import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ALGO = "aes-256-gcm";

function getMasterKey(): Buffer {
    const key = Buffer.from(env.CERT_MASTER_KEY_BASE64, "base64");
    if (key.length !== 32) {
        throw new Error(
            "CERT_MASTER_KEY_BASE64 deve decodificar para 32 bytes (AES-256).",
        );
    }
    return key;
}

export interface EncryptedEnvelope {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
    keyVersion: number;
}

/**
 * Cifra um buffer (arquivo A1 ou senha) com AES-256-GCM.
 * `aad` (dado autenticado associado) deve amarrar o envelope a um contexto
 * fixo -- ex. `${companyId}:${certificateId}:pfx` -- para impedir troca
 * silenciosa de envelopes entre registros.
 */
export function encrypt(plaintext: Buffer, aad: string): EncryptedEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, getMasterKey(), iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return { ciphertext, iv, tag, keyVersion: env.CERT_MASTER_KEY_VERSION };
}

export function decrypt(envelope: EncryptedEnvelope, aad: string): Buffer {
    const decipher = createDecipheriv(ALGO, getMasterKey(), envelope.iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([
        decipher.update(envelope.ciphertext),
        decipher.final(),
    ]);
}
