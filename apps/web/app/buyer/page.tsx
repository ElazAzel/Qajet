import { ScreenLedger } from '../_components/screen-ledger';

export default function BuyerHome() {
  return (
    <ScreenLedger
      roleName="Покупатель"
      entries={[
        {
          name: 'Главная',
          status: 'live',
          note: 'Активные заказы, ближайшие даты, что ждёт действия — §10',
        },
        {
          name: 'Мастер новой заявки',
          status: 'planned',
          note: 'Свободное описание → распознанная спецификация — фаза 5',
        },
        {
          name: 'Счёт на предоплату',
          status: 'planned',
          note: 'Раскрытая оценка: основа, история, запас — фаза 5',
        },
        {
          name: 'Сравнение вариантов',
          status: 'planned',
          note: 'Главный экран продукта, полосы вариантов — фаза 4',
        },
        { name: 'Журнал отбраковки', status: 'planned', note: 'Что не прошло и почему — фаза 4' },
        {
          name: 'Таймлайн заказа',
          status: 'planned',
          note: 'Ответственный за каждую стадию — фаза 5',
        },
        {
          name: 'Закрытие заказа',
          status: 'planned',
          note: 'Сверка предоплаты с фактом, возврат/доплата — фаза 5',
        },
        {
          name: 'Команда и доступы',
          status: 'planned',
          note: 'Приглашение, лимиты согласования, отзыв доступа — фаза 5',
        },
      ]}
    />
  );
}
