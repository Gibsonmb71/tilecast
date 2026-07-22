const WIDGET_SNAPSHOT_WIDTH = 960;
const WIDGET_SNAPSHOT_HEIGHT = 540;

function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Image could not be encoded."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Image could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function inlineImages(source: HTMLElement, clone: HTMLElement) {
  const originals = Array.from(source.querySelectorAll("img"));
  const copies = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    originals.map(async (image, index) => {
      const copy = copies[index];
      const sourceURL = image.currentSrc || image.src;
      if (!copy || !sourceURL || sourceURL.startsWith("data:")) return;
      try {
        const response = await fetch(sourceURL, {
          credentials: "same-origin",
        });
        if (response.ok) copy.src = await blobToDataURL(await response.blob());
      } catch {
        copy.remove();
      }
    }),
  );
}

function inlineComputedStyles(source: Element, clone: Element) {
  const style = getComputedStyle(source);
  const target = (clone as HTMLElement).style;
  for (const property of style)
    target.setProperty(
      property,
      style.getPropertyValue(property),
      style.getPropertyPriority(property),
    );
  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  sourceChildren.forEach((child, index) => {
    const copy = cloneChildren[index];
    if (copy) inlineComputedStyles(child, copy);
  });
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Preview could not be rasterized."));
    image.src = url;
  });
}

function encodeJPEG(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Preview image could not be created.")),
      "image/jpeg",
      quality,
    ),
  );
}

async function captureRenderPreview(
  element: HTMLElement,
  snapshotWidth: number,
  snapshotHeight: number,
  exclude: string[] = [],
): Promise<Blob> {
  await document.fonts.ready;
  const bounds = element.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1)
    throw new Error("Preview is not ready yet.");
  const clone = element.cloneNode(true) as HTMLElement;
  inlineComputedStyles(element, clone);
  await inlineImages(element, clone);
  exclude.forEach((selector) =>
    clone.querySelectorAll(selector).forEach((child) => child.remove()),
  );
  clone
    .querySelectorAll(".is-selected")
    .forEach((child) => child.classList.remove("is-selected"));
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${bounds.width}px`;
  clone.style.height = `${bounds.height}px`;
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${snapshotWidth}" height="${snapshotHeight}" viewBox="0 0 ${bounds.width} ${bounds.height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const svgURL = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml" }),
  );
  try {
    const image = await loadImage(svgURL);
    const canvas = document.createElement("canvas");
    canvas.width = snapshotWidth;
    canvas.height = snapshotHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Preview canvas is unavailable.");
    context.fillStyle = "#000";
    context.fillRect(0, 0, snapshotWidth, snapshotHeight);
    context.drawImage(image, 0, 0, snapshotWidth, snapshotHeight);
    for (const quality of [0.82, 0.68, 0.52]) {
      const snapshot = await encodeJPEG(canvas, quality);
      if (snapshot.size <= 500 * 1024) return snapshot;
    }
    throw new Error("Preview image is too detailed to store.");
  } finally {
    URL.revokeObjectURL(svgURL);
  }
}

export function captureWidgetPreview(element: HTMLElement): Promise<Blob> {
  return captureRenderPreview(
    element,
    WIDGET_SNAPSHOT_WIDTH,
    WIDGET_SNAPSHOT_HEIGHT,
  );
}

export function captureLayoutPreview(
  element: HTMLElement,
  canvasWidth: number,
  canvasHeight: number,
): Promise<Blob> {
  const scale = 960 / Math.max(canvasWidth, canvasHeight);
  return captureRenderPreview(
    element,
    Math.max(1, Math.round(canvasWidth * scale)),
    Math.max(1, Math.round(canvasHeight * scale)),
    [".layout-safe-area", ".layout-guide", ".layout-resize-handle"],
  );
}
