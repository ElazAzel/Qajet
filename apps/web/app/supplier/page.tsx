import { ScreenLedger } from '../_components/screen-ledger';

export default function SupplierHome() {
  return (
    <div className="p-4">
      <ScreenLedger
        roleName="Поставщик"
        entries={[
          { name: 'Онбординг и верификация', status: 'planned', note: '— фаза 5' },
          {
            name: 'Входящие RFQ с дедлайном',
            status: 'live',
            note: 'Мобильный экран, нижние табы — §10',
          },
          {
            name: 'Двухступенчатый ответ',
            status: 'planned',
            note: 'Быстрый «берусь/не берусь» за 30 сек по ссылке без входа — фаза 5',
          },
          {
            name: 'Активные заказы',
            status: 'planned',
            note: 'Подтверждение стадий самим поставщиком — фаза 5',
          },
          {
            name: 'Дашборд роста',
            status: 'planned',
            note: 'Доля вовремя, повторные покупатели — фаза 5',
          },
          { name: 'Публичный профиль и портфолио', status: 'planned', note: '— фаза 5' },
          { name: 'Команда', status: 'planned', note: 'Назначение и передача заказов — фаза 5' },
        ]}
      />
    </div>
  );
}
