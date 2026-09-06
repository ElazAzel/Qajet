import { ScreenLedger } from '../_components/screen-ledger';

export default function ConciergeHome() {
  return (
    <div className="p-6">
      <ScreenLedger
        roleName="Консьерж"
        entries={[
          {
            name: 'Доска заказов по стадиям',
            status: 'live',
            note: 'Подсветка того, что горит по сроку — §10',
          },
          {
            name: 'Карточка заказа',
            status: 'planned',
            note: 'Извлечённые поля, флаги пробелов, треды — фаза 4',
          },
          {
            name: 'Подбор поставщиков',
            status: 'planned',
            note: 'Причины ранжирования, ручная правка — фаза 4',
          },
          {
            name: 'Сведение КП к единым полям',
            status: 'planned',
            note: 'Рабочее пространство нормализации — фаза 4',
          },
          { name: 'Обработка исключений', status: 'planned', note: '— фаза 5' },
          {
            name: 'Учёт времени по стадиям',
            status: 'planned',
            note: 'Автотаймер, стадии — фаза 6',
          },
          { name: 'Библиотека шаблонов', status: 'planned', note: 'Повторяющиеся заявки — фаза 5' },
        ]}
      />
    </div>
  );
}
