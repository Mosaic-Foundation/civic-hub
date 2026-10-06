import { useEffect, useRef, useState } from "react";
import { uploadPostImage, type UploadedImage } from "../services/api";
import "./PostImagePicker.css";

/**
 * Slice 9 — featured-image picker shared by the announcement composer
 * and the admin vote-results review screen.
 *
 * Client-side responsibilities:
 *   - Read the selected file via FileReader/createImageBitmap.
 *   - Resize to ≤ MAX_LONG_EDGE_PX on the long edge using a <canvas>.
 *   - Re-encode to WebP (quality 0.85). Re-encoding via canvas strips
 *     EXIF metadata as a side effect — the spec wants EXIF gone for
 *     privacy and we get that for free.
 *   - POST to /api/upload/post-image (multipart) and surface the
 *     returned URL to the parent.
 *
 * The parent owns the alt-text input — alt is content, not a property
 * of the file itself. We expose an inline alt-text textarea here so the
 * two fields stay visually adjacent and the alt is captured at the
 * same moment the admin sees the preview.
 */

const MAX_LONG_EDGE_PX = 2000;
const WEBP_QUALITY = 0.85;
const ALT_MAX = 200;

/**
 * What a re-encoded image may weigh before it is sent. The server's limit is
 * 4 MB (UPLOAD_CEILING_MB, kept under Vercel's 4.5 MB request limit); this
 * leaves room for the multipart wrapper. An image over it after the first
 * encode is re-encoded smaller (ENCODE_STEPS) rather than refused.
 */
const UPLOAD_BUDGET_BYTES = 3.5 * 1024 * 1024;

/** Tried in order until one fits the budget: scale of the resized size, quality. */
const ENCODE_STEPS: ReadonlyArray<{ scale: number; quality: number }> = [
  { scale: 1, quality: WEBP_QUALITY },
  { scale: 1, quality: 0.7 },
  { scale: 0.75, quality: 0.7 },
  { scale: 0.5, quality: 0.7 },
];

interface Props {
  imageUrl: string | null;
  imageAlt: string | null;
  onChange: (next: { image_url: string | null; image_alt: string | null }) => void;
  disabled?: boolean;
  uploadFn?: (file: Blob) => Promise<UploadedImage>;
  /** Skip the alt-text field — for an image nobody else will see (a
   *  screenshot on a bug report), where describing it is busywork. */
  hideAlt?: boolean;
  /** The add button's label. Default "Add featured image" (announcements,
   *  projects); the feedback form says "Add screenshot". */
  addLabel?: string;
  /** "png" keeps the file a PNG (and its transparency) instead of
   *  re-encoding to WebP — for a hub's logo. Default "webp". */
  format?: "webp" | "png";
  /** Longest edge after resize. Default MAX_LONG_EDGE_PX. */
  maxLongEdge?: number;
  /** Replaces the default "JPEG, PNG, WebP, or GIF…" line under the button. */
  formatHint?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number | null }
  | { kind: "error"; message: string };

export default function PostImagePicker({
  imageUrl,
  imageAlt,
  onChange,
  disabled,
  uploadFn = uploadPostImage,
  hideAlt = false,
  addLabel = "Add featured image",
  format = "webp",
  maxLongEdge = MAX_LONG_EDGE_PX,
  formatHint,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Keep a local working copy of alt so users can type freely without
  // round-tripping through the parent on every keystroke. We forward
  // upward on blur and on initial set.
  const [localAlt, setLocalAlt] = useState(imageAlt ?? "");

  useEffect(() => {
    setLocalAlt(imageAlt ?? "");
  }, [imageAlt]);

  function pickFile() {
    fileInputRef.current?.click();
  }

  async function handleFile(file: File) {
    setStatus({ kind: "uploading", progress: null });
    try {
      if (format === "png" && file.type !== "image/png") {
        throw new Error("Choose a PNG file.");
      }
      const blob = await resizeAndEncode(file, format, maxLongEdge);
      const result = await uploadFn(blob);
      onChange({ image_url: result.url, image_alt: imageAlt ?? "" });
      setStatus({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setStatus({ kind: "error", message });
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow selecting the same file again
    if (file) void handleFile(file);
  }

  function removeImage() {
    onChange({ image_url: null, image_alt: null });
    setLocalAlt("");
    setStatus({ kind: "idle" });
  }

  function commitAlt() {
    if (localAlt === (imageAlt ?? "")) return;
    onChange({ image_url: imageUrl, image_alt: localAlt });
  }

  return (
    <div className="post-image-picker">
      <input
        ref={fileInputRef}
        type="file"
        accept={format === "png" ? "image/png" : "image/jpeg,image/png,image/webp,image/gif"}
        className="post-image-picker-file"
        onChange={onFileInputChange}
        disabled={disabled || status.kind === "uploading"}
      />

      {imageUrl ? (
        <div className="post-image-picker-preview">
          <div className="post-image-picker-frame">
            <img src={imageUrl} alt={imageAlt ?? ""} />
          </div>
          <div className="post-image-picker-actions">
            <button
              type="button"
              className="post-image-picker-action"
              onClick={pickFile}
              disabled={disabled || status.kind === "uploading"}
            >
              Replace image
            </button>
            <button
              type="button"
              className="post-image-picker-action post-image-picker-remove"
              onClick={removeImage}
              disabled={disabled || status.kind === "uploading"}
            >
              Remove image
            </button>
          </div>

          {!hideAlt && (
            <>
          <label className="post-image-picker-alt-label" htmlFor="post-image-alt">
            Describe this image for people using screen readers <span className="optional">(optional but recommended)</span>
          </label>
          <p className="form-hint">
            E.g. "Main Street with autumn leaves" — not "photo of Main Street". Helps residents using screen readers understand what's in the photo.
          </p>
          <textarea
            id="post-image-alt"
            className="form-textarea post-image-picker-alt"
            value={localAlt}
            onChange={(e) => setLocalAlt(e.target.value.slice(0, ALT_MAX))}
            onBlur={commitAlt}
            maxLength={ALT_MAX}
            rows={2}
            disabled={disabled || status.kind === "uploading"}
            placeholder="Brief description of the image"
          />
            </>
          )}
          <span className="form-counter">
            {localAlt.length} / {ALT_MAX}
          </span>
        </div>
      ) : (
        <div className="post-image-picker-empty">
          <button
            type="button"
            className="post-image-picker-pick"
            onClick={pickFile}
            disabled={disabled || status.kind === "uploading"}
          >
            {status.kind === "uploading" ? "Uploading…" : addLabel}
          </button>
          <p className="form-hint">
            {formatHint ??
              `Optional. JPEG, PNG, WebP, or GIF. Resized to ${maxLongEdge} px on the long edge before upload.`}
          </p>
        </div>
      )}

      {status.kind === "error" && (
        <p className="form-error post-image-picker-error">{status.message}</p>
      )}
    </div>
  );
}

/**
 * Resize an input File to at most MAX_LONG_EDGE_PX on its long edge,
 * re-encode to WebP at WEBP_QUALITY. The canvas re-encode strips EXIF
 * metadata (camera, GPS, etc.) as a side effect — that is desired. If the
 * result is over UPLOAD_BUDGET_BYTES, it steps down through ENCODE_STEPS.
 */
async function resizeAndEncode(
  file: File,
  format: "webp" | "png" = "webp",
  maxLongEdge: number = MAX_LONG_EDGE_PX,
): Promise<Blob> {
  // createImageBitmap honors the orientation hint so portrait photos
  // arrive right-side-up. Falls back to <img> on browsers that lack
  // imageOrientation support.
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await loadViaImg(file);
  }
  try {
    const sourceWidth = "width" in bitmap ? bitmap.width : 0;
    const sourceHeight = "height" in bitmap ? bitmap.height : 0;
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const fit = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;

    if (format === "png") {
      // PNG is lossless and keeps the alpha channel, which is the point.
      const png = await encode(bitmap, sourceWidth * fit, sourceHeight * fit, "image/png");
      if (png.size > UPLOAD_BUDGET_BYTES) throw new Error(tooLarge());
      return png;
    }

    for (const step of ENCODE_STEPS) {
      const w = sourceWidth * fit * step.scale;
      const h = sourceHeight * fit * step.scale;
      let blob = await encode(bitmap, w, h, "image/webp", step.quality).catch(() => null);
      // WebP unsupported — fall back to JPEG. Quality slightly higher
      // since JPEG handles photos better than WebP at the same byte cost.
      if (!blob || blob.type !== "image/webp") {
        blob = await encode(bitmap, w, h, "image/jpeg", Math.min(0.9, step.quality + 0.05));
      }
      if (blob.size <= UPLOAD_BUDGET_BYTES) return blob;
    }
    throw new Error(tooLarge());
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function tooLarge(): string {
  return `This image is still over ${Math.round((UPLOAD_BUDGET_BYTES / (1024 * 1024)) * 10) / 10} MB after resizing. Try a smaller image.`;
}

/** Draw the image at width × height and encode it. */
async function encode(
  bitmap: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  type: "image/webp" | "image/jpeg" | "image/png",
  quality?: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("Browser could not encode the image.");
  return blob;
}

function loadViaImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the selected image."));
    };
    img.src = url;
  });
}
