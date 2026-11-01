import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Load pure TypeScript helpers without requiring a browser or a live mailbox.
function load(file) {
  const source = fs.readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  new Function('exports', outputText)(exports);
  return exports;
}
const { findUnsubscribeLink } = load('unsubscribe');
const { groupBySender, folderBatches } = load('sender-groups');

test('prefers HTTPS header over mailto and body links', () => {
  assert.equal(findUnsubscribeLink('<mailto:leave@example.com>, <https://example.com/remove>', '<a href="https://other.example/">unsubscribe</a>'), 'https://example.com/remove');
});
test('detects German nested labels and decodes HTML URLs', () => {
  assert.equal(findUnsubscribeLink('', '<a href="https://example.com/tracking?a=1&amp;b=2"><b>Jetzt abbestellen</b></a>'), 'https://example.com/tracking?a=1&b=2');
  assert.equal(findUnsubscribeLink('', "<a href='https://example.com/link'>Abmelden</a>"), 'https://example.com/link');
});
test('detects unsubscribe URL and plain-text links', () => {
  assert.equal(findUnsubscribeLink('', '<a href=https://example.com/unsubscribe>Click here</a>'), 'https://example.com/unsubscribe');
  assert.equal(findUnsubscribeLink('', '', 'Unsubscribe: https://example.com/remove'), 'https://example.com/remove');
});
test('rejects unsafe links and does not treat ordinary text as a link', () => {
  assert.equal(findUnsubscribeLink('', '<a href="javascript:alert(1)">Unsubscribe</a>'), undefined);
  assert.equal(findUnsubscribeLink('', '<a href="/relative">abbestellen</a>'), undefined);
  assert.equal(findUnsubscribeLink('', '', 'Please unsubscribe from this newsletter'), undefined);
  assert.equal(findUnsubscribeLink('', '<a href="https://example.com/account">Account login</a>'), undefined);
});
const email = (overrides = {}) => ({ mailbox: 'me@example.com', senderEmail: 'Sender@example.com', senderName: 'Sender', uid: 1, folder: 'INBOX', date: new Date(), deleted: 0, category: 'personal', ...overrides });
test('groups all categories and folders by normalized address, excluding deleted messages', () => {
  const groups = groupBySender([email(), email({ uid: 2, senderEmail: ' sender@EXAMPLE.com ', folder: 'Spam', category: 'newsletter' }), email({ uid: 3, deleted: 1 })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].emails.length, 2);
});
test('keeps identical UIDs in different folders separate and batches within limits', () => {
  const batches = folderBatches([email(), email({ folder: 'Spam' }), email({ uid: 2 }), email({ uid: 3 })], 2);
  assert.deepEqual(batches.map(batch => batch.map(item => [item.folder, item.uid])), [ [['INBOX', 1], ['INBOX', 2]], [['INBOX', 3]], [['Spam', 1]] ]);
});

const { findTrashFolder } = load('mail-folders');
const folder = (path, overrides = {}) => ({ path, name: path.split(/[/.]/).at(-1), flags: new Set(), ...overrides });
test('prefers server-designated Trash over an ordinary folder named Trash', () => {
  assert.equal(findTrashFolder([folder('Trash'), folder('[Gmail]/Papierkorb', { specialUse: '\\Trash' })]), '[Gmail]/Papierkorb');
});
test('recognizes Trash flags and arbitrary localized names', () => {
  assert.equal(findTrashFolder([folder('Corbeille', { flags: new Set(['\\Trash']) })]), 'Corbeille');
});
test('falls back to German and namespaced folder names', () => {
  for (const path of ['[Gmail]/Papierkorb', '[Google Mail]/Papierkorb', 'INBOX.Trash', 'Gelöschte Elemente']) {
    assert.equal(findTrashFolder([folder(path)]), path);
  }
});
test('does not select nonselectable or loosely matching folders', () => {
  assert.equal(findTrashFolder([folder('Trash', { flags: new Set(['\\Noselect', '\\Trash']) }), folder('Trash archive'), folder('INBOX')]), undefined);
});

const { groupEmails } = load('sender-groups');
test('sender grouping remains the default', () => {
  assert.equal(groupEmails([email(), email({ senderEmail: 'offers@example.com' })]).length, 2);
});
test('domain grouping combines addresses and keeps per-sender unsubscribe links', () => {
  const groups = groupEmails([
    email({ senderEmail: 'news@HELLO.courier', unsubscribeLink: 'https://hello.courier/news', unsubscribeCheckedAt: 1 }),
    email({ senderEmail: 'offers@hello.courier', uid: 2, folder: 'Spam', unsubscribeLink: 'https://hello.courier/offers' }),
    email({ senderEmail: 'news@hello.courier', uid: 3 }),
    email({ senderEmail: 'deleted@hello.courier', deleted: 1 }),
  ], 'domain');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].address, '@hello.courier');
  assert.equal(groups[0].emails.length, 3);
  assert.equal(groups[0].senders.length, 2);
  assert.equal(groups[0].checked, 1);
  assert.deepEqual(groups[0].senders.map(sender => sender.link), ['https://hello.courier/news', 'https://hello.courier/offers']);
  // Group checks process every sender while retaining folder-scoped message identities.
  assert.deepEqual(folderBatches(groups[0].emails, 25).map(batch => batch.map(item => [item.folder, item.uid])), [[['INBOX', 1], ['INBOX', 3]], [['Spam', 2]]]);
});
test('domain grouping keeps subdomains, unrelated domains and invalid addresses separate', () => {
  const addresses = ['a@example.com', 'b@news.example.com', 'c@other.com', 'invalid', ''];
  const groups = groupEmails(addresses.map(senderEmail => email({ senderEmail })), 'domain');
  assert.equal(groups.length, addresses.length);
  assert.deepEqual(groups.map(group => group.address), ['@example.com', '@news.example.com', '@other.com', 'invalid', '']);
});
