#!/usr/bin/env node
// Генерирует ANON_KEY/SERVICE_ROLE_KEY для self-hosted Supabase — это не
// произвольные строки, а HS256 JWT (header.payload.signature, каждая часть
// base64url), подписанные JWT_SECRET, с claim'ом role: "anon"/"service_role".
// GoTrue и PostgREST проверяют именно эту подпись через тот же JWT_SECRET.
//
// Только node:crypto, без зависимостей — та же линия, что и
// apps/web/app/lib/signed-link.ts: этот проект сознательно не берёт
// jsonwebtoken (его doc-comment объясняет почему — класс уязвимостей
// alg: none), продолжаем на ручном HMAC-SHA256 и здесь, не заводя новую
// зависимость под одноразовый скрипт генерации ключей.
//
// Использование:
//   JWT_SECRET=<секрет> node docker/supabase-init/generate-keys.mjs

import { createHmac } from 'node:crypto';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${headerPart}.${payloadPart}.${signature}`;
}

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  console.error('Задайте JWT_SECRET (минимум 32 символа) в окружении перед запуском.');
  console.error(
    'Пример: JWT_SECRET=$(openssl rand -base64 32) node docker/supabase-init/generate-keys.mjs',
  );
  process.exit(1);
}

const iat = Math.floor(Date.now() / 1000);
// 10 лет — та же практика, что в .env.example апстрима (self-hosted стек
// не рассчитан на ротацию ключей так же часто, как Supabase Cloud).
const exp = iat + 10 * 365 * 24 * 60 * 60;

const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat, exp }, secret);
const serviceRoleKey = signJwt({ role: 'service_role', iss: 'supabase', iat, exp }, secret);

console.log(`ANON_KEY=${anonKey}`);
console.log(`SERVICE_ROLE_KEY=${serviceRoleKey}`);
