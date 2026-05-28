/**
 * Security utilities for API key encryption at rest.
 * Keys are AES-256-GCM encrypted before storage.
 * They are NEVER logged, NEVER exposed in full via API.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getDerivedKey(): Buffer {
  const secret = process.env.WIREBRIDGE_ENCRYPTION_SECRET || 'wirebridge-dev-secret-change-in-prod';
  return crypto.scryptSync(secret, 'wirebridge-salt', KEY_LENGTH);
}

export function encrypt(plaintext: string): { encrypted: string; id: string } {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  
  // Store as: iv:tag:encrypted (all hex)
  const combined = `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  const id = crypto.randomUUID();
  
  return { encrypted: combined, id };
}

export function decrypt(combined: string, _id: string): string {
  const key = getDerivedKey();
  const parts = combined.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  
  const [ivHex, tagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Mask an API key for display — show first 8 chars and last 4.
 * e.g. "sk-ant-api03-abcdefg..." → "sk-ant-a••••••••1234"
 */
export function mask(key: string): string {
  if (key.length <= 12) return '••••••••';
  const start = key.slice(0, 8);
  const end = key.slice(-4);
  return `${start}${'•'.repeat(8)}${end}`;
}

/**
 * Validate that a string looks like a Claude API key.
 * Does NOT make a network call — purely format validation.
 */
export function validateKeyFormat(key: string): boolean {
  return /^sk-ant-[a-zA-Z0-9\-_]{20,}$/.test(key);
}

export function generateBridgeToken(): string {
  return `bridge-${crypto.randomBytes(24).toString('hex')}`;
}
