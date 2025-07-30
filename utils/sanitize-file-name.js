export function sanitizeFilename(url) {
  return url
    .replace(/https?:\/\//, "") // Remove the protocol
    .replace(/[^a-z0-9]/gi, "_") // Replace any character that is not alphanumeric
    .toLowerCase(); // Convert to lowercase to maintain consistency
}
