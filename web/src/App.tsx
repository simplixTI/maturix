import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Accounts } from './pages/Accounts';
import { Warmup } from './pages/Warmup';
import { Send } from './pages/Send';
import { Conversations } from './pages/Conversations';
import { Templates } from './pages/Templates';
import { Media } from './pages/Media';
import { Businesses } from './pages/Businesses';
import { Profiles } from './pages/Profiles';
import { WarmingGroups } from './pages/WarmingGroups';
import { Discovery } from './pages/Discovery';
import { LiveGroups } from './pages/LiveGroups';
import { Proxies } from './pages/Proxies';
import { Alerts } from './pages/Alerts';
import { Calls } from './pages/Calls';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <Loading label="Carregando painel…" />;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/contas" element={<Accounts />} />
        <Route path="/aquecimento" element={<Warmup />} />
        <Route path="/enviar" element={<Send />} />
        <Route path="/conversas" element={<Conversations />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/midia" element={<Media />} />
        <Route path="/empresas" element={<Businesses />} />
        <Route path="/perfil" element={<Profiles />} />
        <Route path="/grupos-aquecimento" element={<WarmingGroups />} />
        <Route path="/descoberta" element={<Discovery />} />
        <Route path="/grupos-ativos" element={<LiveGroups />} />
        <Route path="/proxies" element={<Proxies />} />
        <Route path="/alertas" element={<Alerts />} />
        <Route path="/chamadas" element={<Calls />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/config" element={<Settings />} />
        {user.role === 'ADMIN' && <Route path="/usuarios" element={<Users />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
