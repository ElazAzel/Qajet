import { ScreenLedger } from '../_components/screen-ledger';

export default function AdminHome() {
  return (
    <ScreenLedger
      roleName="Админ"
      entries={[
        {
          name: 'Верификация поставщиков',
          status: 'live',
          note: 'Комплаенс, дата последней проверки — §10',
        },
        {
          name: 'Настройка комиссии и тарифов',
          status: 'planned',
          note: 'База комиссии, запас калькулятора — фаза 6',
        },
        {
          name: 'Финансовая сверка',
          status: 'planned',
          note: 'Предоплаты, выплаты, резервы — фаза 5',
        },
        {
          name: 'Как система учится',
          status: 'planned',
          note: 'MAPE, слоты исследования, версии моделей — фаза 6',
        },
        { name: 'Справочники и шаблоны', status: 'planned', note: '— фаза 5' },
        { name: 'Пользователи и права', status: 'planned', note: '— фаза 1' },
        { name: 'Журнал споров', status: 'planned', note: '— фаза 5' },
        { name: 'Outbox', status: 'planned', note: 'Исходящие уведомления в dev — §2' },
      ]}
    />
  );
}
