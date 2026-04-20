/**
 * Run from repo root: node matriya-back/scripts/verify-finance-whatsapp-routing.js
 * Or: cd matriya-back && node scripts/verify-finance-whatsapp-routing.js
 */
import assert from 'node:assert/strict';
import {
  isFinanceWhatsappCommand,
  normalizeFinanceCommandBody,
  buildFinanceCommandReply,
  resolveShadowSignalsLogPath,
} from '../lib/financeWhatsAppCommands.js';

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`  OK  ${name}`);
}

console.log('[verify-finance-whatsapp-routing]');

ok('F STATUS is finance', isFinanceWhatsappCommand('F STATUS'));
ok('f status is finance (case)', isFinanceWhatsappCommand('f status'));
ok('STATUS legacy is finance', isFinanceWhatsappCommand('STATUS'));
ok('F alone is NOT finance', !isFinanceWhatsappCommand('F'));
ok('FHELP no space is NOT finance', !isFinanceWhatsappCommand('FHELP'));
ok('lab question is NOT finance', !isFinanceWhatsappCommand('What is experiment 42?'));

ok('normalize F STATUS → STATUS', normalizeFinanceCommandBody('F STATUS') === 'STATUS');
ok('normalize STATUS → STATUS', normalizeFinanceCommandBody('STATUS') === 'STATUS');

const help = buildFinanceCommandReply('HELP');
ok('HELP mentions F STATUS', help.includes('F STATUS'));
ok('HELP mentions legacy', help.includes('legacy'));

const logPath = resolveShadowSignalsLogPath();
console.log(`  …  resolveShadowSignalsLogPath() → ${logPath}`);

const statusReply = buildFinanceCommandReply('STATUS');
ok('STATUS returns string', typeof statusReply === 'string' && statusReply.length > 0);

console.log('[verify-finance-whatsapp-routing] all checks passed.');
