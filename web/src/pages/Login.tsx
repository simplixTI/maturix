import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Field, Input } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@braske.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-aside">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div className="col">
            <span className="brand-name">Maturador</span>
            <span className="brand-sub">WhatsApp</span>
          </div>
        </div>
        <h1 className="login-headline">
          Aqueça números em<br />
          <span className="accent-grad">escala empresarial</span>
        </h1>
        <p className="login-lede">
          Painel de controle para conexão, aquecimento anti-ban e monitoramento
          de contas WhatsApp em tempo real.
        </p>
        <ul className="login-points">
          <li><span className="dot live" /> Conexão por QR ou código de pareamento</li>
          <li><span className="dot live" /> Motor de aquecimento com curva circadiana</li>
          <li><span className="dot live" /> Métricas, alertas e logs ao vivo</li>
        </ul>
      </div>

      <div className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <div className="col" style={{ gap: 4, marginBottom: 8 }}>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>Entrar no painel</h2>
            <p className="muted text-sm">Use suas credenciais de operador.</p>
          </div>

          <Field label="E-mail">
            <Input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              required
            />
          </Field>

          <Field label="Senha" error={error}>
            <Input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={error ? 'input-error' : ''}
              required
            />
          </Field>

          <Button type="submit" variant="primary" block loading={loading}>
            Entrar
          </Button>

          <p className="text-xs muted center" style={{ marginTop: 4 }}>
            Conexão segura com o servidor local · porta 3000
          </p>
        </form>
      </div>
    </div>
  );
}
