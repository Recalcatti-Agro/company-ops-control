"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api";
import Modal from "./Modal";

// Confirmación antes de una acción que no se deshace (borrar). Con `blocked` solo
// explica por qué no se puede; igual muestra el error del backend si lo rechaza.
export default function ConfirmModal({
  title,
  children,
  confirmLabel = "Borrar",
  blocked = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  blocked?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err, "No se pudo completar la acción."));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="form">
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
        {error && <div className="err">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost" onClick={onClose}>{blocked ? "Entendido" : "Cancelar"}</button>
          {!blocked && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={confirm}>
              {busy ? "..." : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
