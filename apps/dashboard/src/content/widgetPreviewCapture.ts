const SNAPSHOT_WIDTH = 960;
const SNAPSHOT_HEIGHT = 540;

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
      if (!copy || !image.currentSrc || image.currentSrc.startsWith("data:"))
        return;
      try {
        const response = await fetch(image.currentSrc, {
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
    image.onerror = () =>
      reject(new Error("Widget preview could not be rasterized."));
    image.src = url;
  });
}

function encodeJPEG(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Widget preview image could not be created.")),
      "image/jpeg",
      quality,
    ),
  );
}

export async function captureWidgetPreview(
  element: HTMLElement,
): Promise<Blob> {
  await document.fonts.ready;
  const bounds = element.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1)
    throw new Error("Widget preview is not ready yet.");
  const clone = element.cloneNode(true) as HTMLElement;
  inlineComputedStyles(element, clone);
  await inlineImages(element, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${bounds.width}px`;
  clone.style.height = `${bounds.height}px`;
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SNAPSHOT_WIDTH}" height="${SNAPSHOT_HEIGHT}" viewBox="0 0 ${bounds.width} ${bounds.height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const svgURL = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml" }),
  );
  try {
    const image = await loadImage(svgURL);
    const canvas = document.createElement("canvas");
    canvas.width = SNAPSHOT_WIDTH;
    canvas.height = SNAPSHOT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Widget preview canvas is unavailable.");
    context.fillStyle = "#000";
    context.fillRect(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
    context.drawImage(image, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
    for (const quality of [0.82, 0.68, 0.52]) {
      const snapshot = await encodeJPEG(canvas, quality);
      if (snapshot.size <= 500 * 1024) return snapshot;
    }
    throw new Error("Widget preview image is too detailed to store.");
  } finally {
    URL.revokeObjectURL(svgURL);
  }
}
