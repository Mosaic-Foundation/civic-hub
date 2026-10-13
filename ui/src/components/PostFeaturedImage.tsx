import { useState } from "react";
import Modal from "./Modal";
import "./PostFeaturedImage.css";

/**
 * Slice 9 — public-facing featured image used on Announcement and
 * VoteResults pages. Lazy-loaded; tap/click opens a lightbox via the
 * one Modal.
 *
 * Aspect-ratio container is set to 16:9 so the image slot has a fixed
 * height before the bytes arrive, avoiding cumulative layout shift.
 * `object-fit: cover` keeps the framing predictable.
 */

interface Props {
  src: string;
  alt: string;
}

export default function PostFeaturedImage({ src, alt }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="post-featured-image-button"
        onClick={() => setOpen(true)}
        aria-label="Open image in larger view"
      >
        <span className="post-featured-image-frame">
          <img src={src} alt={alt} loading="lazy" decoding="async" />
        </span>
      </button>

      {open && (
        <Modal
          title={alt || "Featured image"}
          hideTitle
          closeLabel="Close"
          className="post-featured-image-dialog"
          bodyClassName="post-featured-image-body"
          onClose={() => setOpen(false)}
        >
          <img src={src} alt={alt} className="post-featured-image-dialog-img" />
        </Modal>
      )}
    </>
  );
}
