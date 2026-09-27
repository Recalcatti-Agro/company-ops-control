"use client";

import { IconEdit, IconTrash } from "./icons";

// Botones Editar / Borrar al final de una fila. Frenan la propagación para que
// no disparen el click de la fila (navegar, expandir).
export default function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  if (!onEdit && !onDelete) return null;
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      {onEdit && (
        <button type="button" className="icon-btn" title="Editar" aria-label="Editar" onClick={onEdit}>
          <IconEdit />
        </button>
      )}
      {onDelete && (
        <button type="button" className="icon-btn icon-btn-danger" title="Borrar" aria-label="Borrar" onClick={onDelete}>
          <IconTrash />
        </button>
      )}
    </div>
  );
}
