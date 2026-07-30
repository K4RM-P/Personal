import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Pencil, Trash2, Plus } from 'lucide-react'
import type { AuthUser, UserRole } from '@shared/types'
import { useCurrentUser } from '../context/CurrentUserContext'

function isError<T>(v: T | { error: string }): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v
}

const inputCls =
  'w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none'

export function UsersScreen(): React.JSX.Element {
  const { user: currentUser } = useCurrentUser()
  const [users, setUsers] = React.useState<AuthUser[]>([])
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showAdd, setShowAdd] = React.useState(false)
  const [editing, setEditing] = React.useState<AuthUser | null>(null)
  const [deleting, setDeleting] = React.useState<AuthUser | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    const result = await window.api.user.list()
    if (isError(result)) {
      setLoadError(result.error)
      return
    }
    setLoadError(null)
    setUsers(result)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Users</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Manage staff accounts and roles.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          <Plus className="h-4 w-4" /> Add New User
        </button>
      </div>

      {loadError && (
        <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{loadError}</div>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="py-2 pr-4 font-medium">Full Name</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Created</th>
              <th className="py-2 pr-4 font-medium">Last Login</th>
              <th className="py-2 pr-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border)] last:border-0 text-[var(--foreground)]">
                <td className="py-2 pr-4 font-medium">
                  {u.fullName}
                  {currentUser?.id === u.id && <span className="ml-2 text-xs text-[var(--muted-foreground)]">(you)</span>}
                </td>
                <td className="py-2 pr-4">{u.role === 'MANAGER' ? 'Manager' : 'Cashier'}</td>
                <td className="py-2 pr-4 text-[var(--muted-foreground)]">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-2 pr-4 text-[var(--muted-foreground)]">{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditing(u)} title="Edit" className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-[var(--foreground)] hover:bg-[var(--muted)]">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleting(u)} title="Delete" className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-[var(--error)] hover:bg-[var(--error-bg)]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && !loadError && (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-[var(--muted-foreground)]">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); void refresh() }} />}
      {editing && <EditUserModal user={editing} isSelf={editing.id === currentUser?.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh() }} />}
      {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void refresh() }} />}
    </div>
  )
}

function Modal({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-3">{children}</Card>
    </div>
  )
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [fullName, setFullName] = React.useState('')
  const [role, setRole] = React.useState<UserRole>('CASHIER')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    if (!fullName.trim()) return setError('Full name is required.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const result = await window.api.user.create({ fullName: fullName.trim(), password, role })
      if (isError(result)) return setError(result.error)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal>
      <CardHeader>
        <CardTitle>Add New User</CardTitle>
        <CardDescription>Create a staff account.</CardDescription>
      </CardHeader>
      {error && <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{error}</div>}
      <input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
      <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
        <option value="CASHIER">Cashier</option>
        <option value="MANAGER">Manager</option>
      </select>
      <input type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
      <input type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button onClick={onClose} disabled={busy} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">Cancel</button>
        <button onClick={() => void submit()} disabled={busy} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{busy ? 'Saving…' : 'Create User'}</button>
      </div>
    </Modal>
  )
}

function EditUserModal({ user, isSelf, onClose, onSaved }: { user: AuthUser; isSelf: boolean; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [role, setRole] = React.useState<UserRole>(user.role)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    if (password !== '' && password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== '' && password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const result = await window.api.user.update(user.id, role, password || undefined)
      if (isError(result)) return setError(result.error)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal>
      <CardHeader>
        <CardTitle>Edit User</CardTitle>
        <CardDescription>{user.fullName}</CardDescription>
      </CardHeader>
      {error && <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{error}</div>}
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Full name (username — not editable)</label>
        <input value={user.fullName} disabled className={`${inputCls} opacity-60`} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={isSelf} className={`${inputCls} ${isSelf ? 'opacity-60' : ''}`}>
          <option value="CASHIER">Cashier</option>
          <option value="MANAGER">Manager</option>
        </select>
        {isSelf && <p className="mt-1 text-xs text-[var(--muted-foreground)]">You cannot change your own role.</p>}
      </div>
      <input type="password" placeholder="New password (leave blank to keep current)" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
      {password !== '' && <input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button onClick={onClose} disabled={busy} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">Cancel</button>
        <button onClick={() => void submit()} disabled={busy} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{busy ? 'Saving…' : 'Save Changes'}</button>
      </div>
    </Modal>
  )
}

function DeleteUserDialog({ user, onClose, onDeleted }: { user: AuthUser; onClose: () => void; onDeleted: () => void }): React.JSX.Element {
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const confirmDelete = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.user.delete(user.id)
      if (isError(result)) return setError(result.error)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal>
      <CardTitle>Delete user</CardTitle>
      <p className="text-sm text-[var(--foreground)]">Are you sure you want to delete {user.fullName}? This action cannot be undone.</p>
      <p className="text-xs text-[var(--muted-foreground)]">Their sales history and other records stay attributed to them for audit purposes.</p>
      {error && <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{error}</div>}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button onClick={onClose} disabled={busy} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">Cancel</button>
        <button onClick={() => void confirmDelete()} disabled={busy} className="min-h-11 rounded-[var(--radius)] bg-[var(--error)] px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Modal>
  )
}
