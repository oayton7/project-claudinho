/**
 * Image handling for the Judge, all client-side.
 *
 * Screenshots come off a Retina display at silly resolutions. Claude charges
 * by image size, so a full-resolution screenshot costs several times what a
 * sensibly scaled one does and tells it nothing extra about whether a listing
 * photo is any good. Everything is downscaled before it leaves the browser.
 */

/** Plenty to judge composition, lighting and clarity. Beyond this you pay for pixels you do not need. */
const MAX_EDGE = 1568;

/** Four is enough to cover a search results page and the main listing images. */
export const MAX_IMAGES = 4;

export type JudgeImage = {
  /** base64, no data: prefix — that is what the API wants */
  data: string;
  mediaType: "image/jpeg";
  /** For the thumbnail in the form */
  preview: string;
  label: string;
};

export async function prepareImage(file: File): Promise<JudgeImage> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read that image");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // JPEG at 0.85 keeps text in a screenshot readable at a fraction of the size.
  const preview = canvas.toDataURL("image/jpeg", 0.85);

  return {
    data: preview.split(",")[1],
    mediaType: "image/jpeg",
    preview,
    label: file.name || "pasted image",
  };
}

/** Pulls image files out of a paste event, so Cmd+V on a screenshot just works. */
export function imagesFromPaste(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
