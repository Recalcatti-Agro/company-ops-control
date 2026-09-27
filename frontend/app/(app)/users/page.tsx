"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { IconPlus } from "@/components/icons";
import { PageHeader } from "@/components/ui";

type User = { id: number; username: string; email: string; role: string; is_active: boolean; investor_id: number | null; investor_name: string | null };
type Investor = { id: number; name: string };

export default function UsersPage() {
  const { session } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "INVESTOR", is_active: true });

  function load() {
    setLoading(true);
    Promise.all([api.get("/users/"), api.get("/investors/")]).then(([u, i]) => { setUsers(u); setInvestors(i); }).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        const { password, ...rest } = form;
        await api.patch(`/users/${editingId}/`, password ? form : rest);
      } else {
        await api.post("/users/", form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar el usuario."));
    }
  }

  async function linkInvestor(user: User, investorId: string) {
    await api.post(`/users/${user.id}/link-investor/`, { investor_id: investorId || null });
    load();
  }

  return (
    <div>
      <PageHeader
        title="Usuarios"
        sub={`${users.length} usuarios`}
        actions={
          <button className="btn" onClick={() => { setEditingId(null); setForm({ username: "", email: "", password: "", role: "INVESTOR", is_active: true }); setError(""); setShowForm(true); }}>
            <IconPlus size={16} /> Nuevo usuario
          </button>
        }
      />

      {loading ? <div className="empty">Cargando...</div> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Inversor vinculado</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}{!u.is_active && <span className="chip c-pending" style={{ marginLeft: 6 }}>Inactivo</span>}</td>
                  <td>{u.email || "—"}</td>
                  <td>{u.role}</td>
                  <td>
                    <select value={u.investor_id ?? ""} onChange={(e) => linkInvestor(u, e.target.value)} style={{ width: 180 }}>
                      <option value="">Sin vincular</option>
                      {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </td>
                  <td className="actions">
                    <RowActions
                      onEdit={() => { setEditingId(u.id); setForm({ username: u.username, email: u.email || "", password: "", role: u.role, is_active: u.is_active }); setError(""); setShowForm(true); }}
                      onDelete={u.id === session?.userId ? undefined : () => setDeleting(u)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? "Editar usuario" : "Nuevo usuario"} onClose={() => setShowForm(false)}>
          <form className="form" onSubmit={submit}>
            <div>
              <label className="field-label">Usuario</label>
              <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{editingId ? "Nueva contraseña (vacío = no cambiar)" : "Contraseña"}</label>
              <input type="password" required={!editingId} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Rol</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="INVESTOR">Inversor</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            {editingId && (
              <label className="row" style={{ fontSize: 13.5 }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Activo (puede iniciar sesión)
              </label>
            )}
            {error && <div className="err">{error}</div>}
            <button className="btn" type="submit">{editingId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar usuario"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/users/${deleting.id}/`); setDeleting(null); load(); }}
        >
          ¿Borrar el usuario <b>{deleting.username}</b>?
          <div className="small" style={{ marginTop: 6 }}>
            Lo que cargó queda, sin autor. Si solo querés cortarle el acceso, editalo y desmarcá “Activo”. No se puede deshacer.
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
