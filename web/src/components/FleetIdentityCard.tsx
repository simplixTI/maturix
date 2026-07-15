import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { Card, Button, Badge } from './ui';
import { formatPhone } from '../lib/format';

interface FleetIdentity {
  accountId: string;
  phoneNumber: string;
  displayName: string | null;
  status: string;
  warmupDay: number;
  activeStart: number;
  activeEnd: number;
  circadianOffset: number;
  activeNow: boolean;
  intensityPct: number;
  dailyLimit: number;
  baseDailyLimit: number;
  plannedName: string;
  plannedBio: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Shows the per-account seeded "personality" (active hours, circadian offset,
 * jittered daily cap) plus the maturation profile (name/bio). Makes the fleet
 * desync visible — chips are not in lockstep. Collapsible; fetches only when open.
 */
export function FleetIdentityCard({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { data } = useQuery({
    queryKey: ['fleet-identity'],
    queryFn: () => get<FleetIdentity[]>('/api/accounts/identity'),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  return (
    <Card style={{ marginBottom: 'var(--space-4)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: open ? 10 : 0 }}>
        <h3 style={{ margin: 0 }}>Identidade da frota</h3>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="text-xs muted">cada chip age como uma pessoa diferente — horários, pico e teto não são iguais</span>
          <Button size="sm" variant={open ? 'primary' : 'ghost'} onClick={() => setOpen((v) => !v)}>
            {open ? 'Ocultar' : 'Mostrar'}
          </Button>
        </div>
      </div>

      {open && (!data ? (
        <p className="text-xs muted">Carregando…</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Dia</th>
                  <th>Janela ativa</th>
                  <th title="Está dentro da janela ativa agora + intensidade do horário">Agora</th>
                  <th title="Deslocamento do pico de atividade">Offset</th>
                  <th title="Teto diário com jitter por conta (vs. base da curva)">Teto/dia</th>
                  <th>Nome (perfil)</th>
                  <th>Recado</th>
                </tr>
              </thead>
              <tbody>
                {data.map((it) => (
                  <tr key={it.accountId}>
                    <td className="mono">{formatPhone(it.phoneNumber)}</td>
                    <td className="mono">{it.warmupDay}</td>
                    <td className="mono">{pad(it.activeStart)}h–{pad(it.activeEnd)}h</td>
                    <td>
                      {it.activeNow
                        ? <Badge tone="success" dot={false}>Ativo · {it.intensityPct}%</Badge>
                        : <Badge tone="neutral" dot={false}>Dormindo 🌙</Badge>}
                    </td>
                    <td className="mono">{it.circadianOffset >= 0 ? `+${it.circadianOffset}` : it.circadianOffset}h</td>
                    <td className="mono">
                      {it.dailyLimit}
                      <span className="muted text-xs"> / {it.baseDailyLimit}</span>
                    </td>
                    <td>{it.plannedName}</td>
                    <td className="text-xs muted">{it.plannedBio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs muted" style={{ marginTop: 8 }}>
            Derivado de forma determinística do ID da conta — estável no tempo, sem estado extra. "Teto/dia" mostra o limite com jitter da conta vs. o valor base da curva.
          </p>
        </>
      ))}
    </Card>
  );
}
