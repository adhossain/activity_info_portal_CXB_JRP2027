const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateRecordId(): string {
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  let id = "c";
  for (let i = 0; i < 19; i++) {
    id += CHARS[arr[i] % CHARS.length];
  }
  return id;
}
