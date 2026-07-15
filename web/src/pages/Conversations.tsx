import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { Card, Button, Loading, Empty, Badge } from '../components/ui';
import { IconChat, IconRefresh } from '../components/Icons';
import { formatPhone, formatDateTime, relativeTime } from '../lib/format';
import type { MessageLog } from '../lib/types';

interface Thread {
  participants: string[];
  phones: string[];
  lastMessage: string;
  lastAt: string;
  messageCount: number;
}
interface ThreadsResponse {
  accounts: { id: string; phoneNumber: string; status: string }[];
  threads: Thread[];
}
interface MixedResponse {
  conversation?: string[];
  singles?: string[];
  stats?: Record<string, number>;
}

type Tab = 'threads' | 'messages' | 'generator';

export function Conversations() {
  const [tab, setTab] = useState<Tab>('threads');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conversas</h1>
          <p>Histórico de diálogos entre as contas e gerador de mensagens humanizadas.</p>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'threads' ? 'active' : ''}`} onClick={() => setTab('threads')}>Threads</div>
        <div className={`tab ${tab === 'messages' ? 'active' : ''}`} onClick={() => setTab('messages')}>Mensagens</div>
        <div className={`tab ${tab === 'generator' ? 'active' : ''}`} onClick={() => setTab('generator')}>Prévia de mensagens</div>
      </div>

      {tab === 'threads' && <Threads />}
      {tab === 'messages' && <Messages />}
      {tab === 'generator' && <Generator />}
    </>
  );
}

function Threads() {
  const { data, isLoading } = useQuery({ queryKey: ['threads'], queryFn: () => get<ThreadsResponse>('/api/conversations/threads'), refetchInterval: 20_000 });
  if (isLoading) return <Loading />;
  const threads = data?.threads ?? [];
  if (threads.length === 0) return <Card><Empty icon={<IconChat />} title="Sem conversas ainda" hint="As threads aparecem quando o aquecimento começa a trocar mensagens." /></Card>;
  return (
    <div className="grid grid-3">
      {threads.map((t, i) => (
        <Card key={i}>
          <div className="card-head">
            <span className="card-title text-sm mono">{t.phones.map(formatPhone).join('  ↔  ')}</span>
            <Badge tone="info" dot={false}>{t.messageCount}</Badge>
          </div>
          <p className="text-sm soft" style={{ minHeight: 38 }}>"{t.lastMessage}"</p>
          <span className="text-xs muted">{relativeTime(t.lastAt)}</span>
        </Card>
      ))}
    </div>
  );
}

function Messages() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['messages'], queryFn: () => get<MessageLog[]>('/api/conversations/messages?limit=150') });
  if (isLoading) return <Loading />;
  const messages = data ?? [];
  return (
    <Card className="pad-0">
      <div className="card-head" style={{ padding: 'var(--space-5)', marginBottom: 0 }}>
        <div className="card-title">Últimas mensagens</div>
        <Button size="sm" variant="ghost" onClick={() => refetch()}><IconRefresh /> Atualizar</Button>
      </div>
      {messages.length === 0 ? (
        <Empty icon={<IconChat />} title="Nenhuma mensagem registrada" />
      ) : (
        <div style={{ padding: 'var(--space-4) var(--space-5)', maxHeight: '64vh', overflowY: 'auto' }}>
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.direction === 'OUTBOUND' ? 'out' : 'in'}`}>
              <div>{m.spintaxOutput || `[${m.messageType}]`}</div>
              <div className="bubble-meta">
                {m.sender ? formatPhone(m.sender.phoneNumber) : '—'} → {m.receiver ? formatPhone(m.receiver.phoneNumber) : '—'} · {formatDateTime(m.createdAt)} · {m.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Generator() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mixed'],
    queryFn: () => get<MixedResponse>('/api/conversations/mixed?count=8'),
  });
  if (isLoading) return <Loading />;
  const conv = data?.conversation ?? [];
  const singles = data?.singles ?? [];
  return (
    <>
    <p className="hint" style={{ marginBottom: 'var(--space-4)' }}>
      Esta aba é só uma <strong>prévia</strong> das mensagens humanizadas que o motor escreve. Para criar grupos automaticamente, vá em <strong>Grupos ao vivo → Gerador de grupos</strong>.
    </p>
    <div className="grid grid-2">
      <Card>
        <div className="card-head">
          <div className="card-title">Diálogo simulado</div>
          <Button size="sm" variant="ghost" loading={isFetching} onClick={() => refetch()}><IconRefresh /> Gerar</Button>
        </div>
        {conv.length === 0 ? <Empty title="Mixer não carregado" /> : (
          <div className="col">
            {conv.map((m, i) => (
              <div key={i} className={`bubble ${i % 2 === 0 ? 'out' : 'in'}`}>{m}</div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <div className="card-head"><div className="card-title">Mensagens avulsas</div></div>
        <div className="col gap-2">
          {singles.map((s, i) => (
            <div key={i} className="text-sm" style={{ padding: '6px 10px', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}>{s}</div>
          ))}
        </div>
        {data?.stats && (
          <div className="row wrap gap-2" style={{ marginTop: 'var(--space-4)' }}>
            {Object.entries(data.stats).map(([k, v]) => <Badge key={k} tone="neutral" dot={false}>{k}: {v}</Badge>)}
          </div>
        )}
      </Card>
    </div>
    </>
  );
}
