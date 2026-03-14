import { randomBytes } from "crypto";

/**
 * Generate a prefixed, URL-safe random ID.
 * 12 random bytes → 16 base64url characters → 96 bits of entropy.
 *
 * Convention: sess_, task_, turn_, evt_, art_, sum_
 */
export function generateId(prefix: string): string {
	const bytes = randomBytes(12);
	const encoded = bytes.toString("base64url");
	return `${prefix}_${encoded}`;
}
