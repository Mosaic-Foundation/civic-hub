// The admin rail on a phone (pilot readiness 3, Adam 2026-11-06): the bottom
// bar keeps the hub's tabs, and an Admin button at the top of every admin page
// opens the rail as a drawer from the left. The drawer is the shared Modal, so
// it traps focus, closes on Escape and a tap outside, and gives focus back.
// Following a link closes it. Hub settings' sections stay on its page here.

import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import NavIcon from "./navIcons";
import AdminRail from "./AdminRail";
import "./AdminDrawer.css";

export default function AdminDrawer() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Back to the button on close. Safari doesn't focus a button on a click, so
  // the Modal would have nothing to give focus back to.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <div className="admin-drawer-head">
      <button ref={button} type="button" className="admin-drawer-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <NavIcon name="admin" size={16} />
        <span>Admin</span>
      </button>
      {open && (
        <Modal title="Admin" hideTitle showClose={false} onClose={() => setOpen(false)} className="admin-drawer" bodyClassName="admin-drawer-body">
          <AdminRail onPicked={() => setOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
