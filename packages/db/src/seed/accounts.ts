/**
 * Аккаунты и компании сида — agents.md §13.
 *
 * 4 демо-логина с быстрым входом + 1 дополнительный сотрудник компании-
 * покупателя с другим лимитом согласования (спека требует "2 сотрудника
 * с разными лимитами", а не ровно 4 живых логина — 4 это именно кнопки
 * быстрого входа на странице логина в dev).
 */
import type { SeedSupplier } from './suppliers.js';
import { SEED_SUPPLIERS } from './suppliers.js';

export const DEMO_PASSWORD = 'qajet2026';

export const SEED_BUYER_COMPANY = {
  seedKey: 'buyer-company',
  name: 'ТОО «Nomad Retail Group»',
  bin: '900540990011',
  taxMode: 'general' as const,
  vatStatus: 'registered' as const,
  city: 'Алматы',
  /** Для реалистичности карточки компании в UI — не отдельная колонка схемы. */
  employeeCountApprox: 180,
};

export type SeedAccountRole = 'owner' | 'manager' | 'concierge' | 'admin';

export interface SeedAccount {
  seedKey: string;
  email: string;
  password: string;
  fullName: string;
  role: SeedAccountRole;
  /** null → сотрудник QAJET (concierge/admin), companyId не выставляется. */
  companySeedKey: 'buyer-company' | null;
  approvalLimitKzt: number | null;
  /** Показывается кнопкой быстрого входа на /login в dev — agents.md §13. */
  isQuickLogin: boolean;
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    seedKey: 'demo-buyer',
    email: 'buyer@demo.qajet.kz',
    password: DEMO_PASSWORD,
    fullName: 'Айгерим Сатпаева',
    role: 'owner',
    companySeedKey: 'buyer-company',
    approvalLimitKzt: null,
    isQuickLogin: true,
  },
  {
    seedKey: 'demo-buyer-manager',
    email: 'manager@demo.qajet.kz',
    password: DEMO_PASSWORD,
    fullName: 'Данияр Ахметов',
    role: 'manager',
    companySeedKey: 'buyer-company',
    approvalLimitKzt: 800_000,
    isQuickLogin: false,
  },
  {
    seedKey: 'demo-supplier',
    email: 'supplier@demo.qajet.kz',
    password: DEMO_PASSWORD,
    fullName: 'Ержан Тулегенов',
    role: 'owner',
    companySeedKey: null,
    approvalLimitKzt: null,
    isQuickLogin: true,
  },
  {
    seedKey: 'demo-concierge',
    email: 'concierge@demo.qajet.kz',
    password: DEMO_PASSWORD,
    fullName: 'Мадина Жумабекова',
    role: 'concierge',
    companySeedKey: null,
    approvalLimitKzt: null,
    isQuickLogin: true,
  },
  {
    seedKey: 'demo-admin',
    email: 'admin@demo.qajet.kz',
    password: DEMO_PASSWORD,
    fullName: 'Тимур Оспанов',
    role: 'admin',
    companySeedKey: null,
    approvalLimitKzt: null,
    isQuickLogin: true,
  },
];

/**
 * `supplier@demo.qajet.kz` — живой логин, привязанный к первому поставщику
 * сида (PrintCraft KZ), чтобы демо-сценарий поставщика показывал реальные
 * RFQ/КП, а не пустой дашборд.
 */
export const DEMO_SUPPLIER_COMPANY_SEED_KEY = 'printcraft-kz';

export interface SeedSupplierCompany {
  seedKey: string;
  supplier: SeedSupplier;
}

export const SEED_SUPPLIER_COMPANIES: readonly SeedSupplierCompany[] = SEED_SUPPLIERS.map(
  (supplier) => ({ seedKey: supplier.seedKey, supplier }),
);
