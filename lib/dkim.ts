import crypto from "crypto";

/**
 * Generate DKIM RSA keypair (2048-bit) for DNS publishing.
 * Store private key securely; publish public key in DNS.
 */
export function generateDkimKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  // IMPORTANT:
  // DKIM verifiers (including Gmail) expect the public key in *SubjectPublicKeyInfo* (SPKI) format,
  // which is the PEM block that begins with "BEGIN PUBLIC KEY" (not "BEGIN RSA PUBLIC KEY").
  // If we publish a PKCS#1 "RSA PUBLIC KEY" blob in DNS, some verifiers treat it as an invalid key.
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  // DKIM DNS public key format: remove headers/footers/newlines
  const pub = pubPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    // Backwards compatibility: if a key comes in as PKCS#1 for any reason, strip those too.
    .replace(/-----BEGIN RSA PUBLIC KEY-----/g, "")
    .replace(/-----END RSA PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");

  return { privateKeyPem: privPem, publicKeyDns: pub };
}
