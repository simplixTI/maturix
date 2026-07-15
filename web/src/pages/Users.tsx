import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Stat, Field, Input, Select } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { IconPlus, IconTrash, IconUsers } from '../components/Icons';
import { relativeTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import type { User } from '../lib/types';

interface UserRow extends User {
  accountCount: number;
}

export function Users() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/api/auth/users'), refetchInterval: 30_000 });

  const users = data ?? [];
  const admins = users.filter((u) => u.role === 'ADMIN').length;

  function refresh() { qc.invalidateQueries({ queryKey: ['users'] }); }

  async function remove(u: UserRow) {
    if (!confirm(`Remover o usuário ${u.email}? Esta ação não pode ser desfeita.${u.accountCount > 0 ? `\n\nAtenção: ele possui ${u.accountCount} chip(s) — eles continuarão aquecendo, mas ficarão sem dono no painel.` : ''}`)) return;
    try { await del(`/api/auth/users/${u.id}`); toast.success('Usuário removido'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  async function toggleActive(u: UserRow) {
    try { await patch(`/api/auth/users/${u.id}`, { isActive: !u.isActive }); toast.success(u.isActive ? 'Usuário desativado' : 'Usuário ativado'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  if (isLoading) return <Loading label="Carregando usuários…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuários</h1>
          <p>Logins independentes para operar chips. Cada usuário vê apenas os próprios números — mas todos aquecem no mesmo pool.</p>
        </div>
        <div className="toolbar">
          <Button variant="primary" onClick={() => setAddOpen(true)}><IconPlus /> Novo usuário</Button>
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Usuários" value={users.length} icon={<IconUsers />} />
        <Stat label="Administradores" value={admins} />
        <Stat label="Operadores" value={users.length - admins} />
      </div>

      {users.length === 0 ? (
        <Card><Empty icon={<IconUsers />} title="Nenhum usuário" hint="Crie logins para liberar acesso aos operadores."
          action={<Button variant="primary" onClick={() => setAddOpen(true)}><IconPlus /> Novo usuário</Button>} /></Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>E-mail</th><th>Nome</th><th>Papel</th><th>Status</th><th className="num">Chips</th><th>Último login</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.email}{u.id === me?.id ? ' (você)' : ''}</td>
                  <td>{u.name}</td>
                  <td><Badge tone={u.role === 'ADMIN' ? 'accent' : 'neutral'} dot={false}>{u.role === 'ADMIN' ? 'Admin' : 'Operador'}</Badge></td>
                  <td><Badge tone={u.isActive === false ? 'danger' : 'success'}>{u.isActive === false ? 'Inativo' : 'Ativo'}</Badge></td>
                  <td className="num">{u.accountCount}</td>
                  <td className="text-xs muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'nunca'}</td>
                  <td><div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => setResetFor(u)}>Senha</Button>
                    {u.id !== me?.id && (
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>{u.isActive === false ? 'Ativar' : 'Desativar'}</Button>
                    )}
                    {u.id !== me?.id && (
                      <Button size="sm" variant="ghost" onClick={() => remove(u)} title="Remover"><IconTrash /></Button>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={refresh} />
      <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />
    </>
  );
}

function AddUserModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const [busy, setBusy] = useState(false);

  function reset() { setEmail(''); setName(''); setPassword(''); setRole('USER'); }

  async function save() {
    if (!email || !name || !password) return toast.error('E-mail, nome e senha são obrigatórios');
    if (password.length < 8) return toast.error('A senha deve ter no mínimo 8 caracteres');
    setBusy(true);
    try {
      await post('/api/auth/register', { email, name, password, role });
      toast.success('Usuário criado');
      onSaved(); onClose(); reset();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo usuário"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Criar</Button></>}>
      <div className="grid" style={{ gap: 'var(--space-4)' }}>
        <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="operador@simplix.digital" autoComplete="off" /></Field>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do operador" /></Field>
        <Field label="Senha" hint="Mínimo 8 caracteres"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Papel" hint="Operador vê só os próprios chips. Admin gerencia tudo, inclusive usuários.">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}>
            <option value="USER">Operador</option>
            <option value="ADMIN">Administrador</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!user) return;
    if (password.length < 8) return toast.error('A senha deve ter no mínimo 8 caracteres');
    setBusy(true);
    try {
      await patch(`/api/auth/users/${user.id}`, { password });
      toast.success('Senha redefinida');
      setPassword(''); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={`Redefinir senha · ${user?.email ?? ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <Field label="Nova senha" hint="Mínimo 8 caracteres">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
    </Modal>
  );
}
