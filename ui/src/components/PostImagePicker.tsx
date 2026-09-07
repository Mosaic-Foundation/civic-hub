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

interface Props {
  imageUrl: string | null;
  imageAlt: string | null;
  onChange: (next: { image_url: string | null; image_alt: string | null }) => void;
  disabled?: boolean;
  uploadFn?: (file: Blob) => Promise<UploadedImage>;
  /** Skip the alt-text field — for an image nobody else will see (a
   *  screenshot on a bug report), where describing it is busywork. */
  hideAlt?: boolean;
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
      const blob = await resizeAndEncode(file);
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
        accept="image/jpeg,image/png,image/webp,image/gif"
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
            {status.kind === "uploading" ? "Uploading…" : "Add featured image"}
          </button>
          <p className="form-hint">
            Optional. JPEG, PNG, WebP, or GIF. Resized to {MAX_LONG_EDGE_PX} px on the long edge before upload.
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
 * metadata (camera, GPS, etc.) as a side effect — that is desired.
 */
async function resizeAndEncode(file: File): Promise<Blob> {
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
    const scale = longEdge > MAX_LONG_EDGE_PX ? MAX_LONG_EDGE_PX / longEdge : 1;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );
    if (blob) return blob;
    // WebP unsupported — fall back to JPEG. Quality slightly lower
    // since JPEG handles photos better than 0.85 WebP at the same byte cost.
    const fallback = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!fallback) throw new Error("Browser could not encode the image.");
    return fallback;
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
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
