// Returns the files from a drop only when they came from outside the page
// (Finder, Explorer, another app). Dragging an element that is already on the
// page — an asset thumbnail, for example — also populates dataTransfer.files
// in Chromium with the image bitmap, which would silently re-upload existing
// media as a new asset. Those internal drags always carry a source marker
// type (text/uri-list or text/html); real OS file drops never do.
export function droppedFiles(dataTransfer: {
  types: readonly string[];
  files: ArrayLike<File>;
}): File[] {
  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes("text/uri-list") || types.includes("text/html")) return [];
  return Array.from(dataTransfer.files);
}
