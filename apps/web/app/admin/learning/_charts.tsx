'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExplorationPoint, LeadtimePoint, LearningPoint } from '../../lib/learning-metrics';

const AXIS_COLOR = 'rgba(20,20,26,.5)';
const GRID_COLOR = 'rgba(20,20,26,.08)';

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
}

export function MapeMarginChart({ points }: { points: LearningPoint[] }) {
  const data = points.map((p) => ({
    month: formatMonth(p.trainedAt),
    'MAPE, %': p.avgMapePct === null ? null : Math.round(p.avgMapePct * 10) / 10,
    'Запас, %': Math.round(p.avgMarginPct * 10) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          unit="%"
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 10,
            border: '1px solid rgba(20,20,26,.08)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="MAPE, %"
          stroke="#6C5DD3"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line type="monotone" dataKey="Запас, %" stroke="#B36A16" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function LeadtimeChart({ points }: { points: LeadtimePoint[] }) {
  const data = points.map((p) => ({
    month: formatMonth(p.trainedAt),
    'Поставщиков с историей срока': p.nSuppliersWithHistory,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 10,
            border: '1px solid rgba(20,20,26,.08)',
          }}
        />
        <Line
          type="monotone"
          dataKey="Поставщиков с историей срока"
          stroke="#1F8A3B"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ExplorationChart({ points }: { points: ExplorationPoint[] }) {
  const data = points.map((p) => ({
    month: new Date(`${p.month}-01`).toLocaleDateString('ru-RU', {
      month: 'short',
      year: '2-digit',
    }),
    'Слоты исследования': p.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 10,
            border: '1px solid rgba(20,20,26,.08)',
          }}
        />
        <Line
          type="monotone"
          dataKey="Слоты исследования"
          stroke="#6C5DD3"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
