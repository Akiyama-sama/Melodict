import crypto from 'crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 10;

/**
 * IDs used by the database for artists/albums/palettes/artworks. Uniformly samples the alphabet and
 * rejects the few bytes that would bias the result, which is what `customAlphabet` did for us before
 * this moved off `nanoid` (only a transitive dependency, so pnpm builds could not resolve it).
 */
export const generateRandomId = () => {
  const maxAcceptable = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

  let id = '';
  while (id.length < ID_LENGTH) {
    // Over-sample so the usual case needs a single call.
    for (const byte of crypto.randomBytes(ID_LENGTH)) {
      if (byte >= maxAcceptable) continue;
      id += ALPHABET[byte % ALPHABET.length];
      if (id.length === ID_LENGTH) break;
    }
  }

  return id;
};
