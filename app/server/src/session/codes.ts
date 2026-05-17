// task 2.7 — 6-char session code from a 32-char unambiguous alphabet
// Omits: 0/O, 1/I/L, S/5, 2/Z, 8/B — confusable on a projector

const ALPHABET = "346789ACDEFGHJKMNPQRTUVWXY";
const CODE_LENGTH = 6;

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
