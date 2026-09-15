const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const appSource = scripts.at(-1)?.[1];
assert.ok(appSource, 'app inline script must exist');
new vm.Script(appSource, { filename: 'index.html' });

function createApp() {
  const items = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', value: '', dataset: {}, querySelectorAll: () => [],
      classList: { toggle() {}, add() {}, remove() {}, contains() { return true; } }
    });
    return elements.get(id);
  };
  const sandbox = {
    document: {
      addEventListener() {},
      getElementById: id => id.startsWith('catalog-') ? element(id) : null,
      querySelectorAll: () => [],
      body: { appendChild() {} },
      createElement: () => ({ click() {}, remove() {} })
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem: key => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, value)
    },
    Image: class { set src(_value) { Promise.resolve().then(() => this.onload?.()); } decode() { return Promise.resolve(); } },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp', delete: () => 'delete' } } },
    console: { error() {}, warn() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    Promise, Map, Set, Date, Blob, URL
  };
  vm.createContext(sandbox);
  vm.runInContext(appSource, sandbox, { filename: 'index.html' });
  vm.runInContext('isAdmin = true; requireAdmin = () => true; renderAllViews = () => {};', sandbox);
  return { sandbox, elements, items, run: source => vm.runInContext(source, sandbox) };
}

async function run() {
  const old = [{ id: 99, code: '99', title: '舊書', total: '30', maxNum: '30' }];
  const local = [...old, { id: 999, code: '999', title: '新增', total: '6', maxNum: '6' }];
  const app = createApp();
  app.sandbox.old = old;
  app.sandbox.local = local;
  app.run('booksData = local; catalogLocalBooks = local; catalogHasLocalCache = true; catalogLoadState = "loading"; cloudSyncStatus = "idle";');
  assert.match(app.run('getCloudSyncState().text'), /尚未取得正式清冊/);

  app.run('applyCloudCatalogSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ booksData: old }) });');
  assert.equal(app.run('catalogLoadState'), 'review');
  assert.match(app.elements.get('catalog-source-status').textContent, /正式清冊 1 本，最後編號 99/);
  assert.match(app.elements.get('catalog-merge-rows').innerHTML, /書箱999號/);
  assert.equal(app.run('booksData.some(book => book.code === "999")'), true, 'server snapshot must retain local 999');
  app.run('applyCatalogMerge();');
  assert.equal(app.run('catalogLoadState'), 'ready');
  assert.equal(app.run('booksData.some(book => book.code === "999")'), true, 'default merge keeps local-only book');
  assert.equal(app.run('hasUnsavedAdminChanges'), true);

  const cleanCache = createApp();
  cleanCache.sandbox.old = old;
  cleanCache.sandbox.local = local;
  cleanCache.run('booksData = old; catalogLocalBooks = old; catalogHasLocalCache = true; catalogAcceptedSignature = catalogSignature(old);');
  cleanCache.run('applyCloudCatalogSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ booksData: local }) });');
  assert.equal(cleanCache.run('catalogLoadState'), 'ready');
  assert.equal(cleanCache.run('booksData.some(book => book.code === "999")'), true, 'clean cache follows newer server data');
  const unsavedDraft = createApp();
  unsavedDraft.sandbox.old = old;
  unsavedDraft.sandbox.local = local;
  unsavedDraft.run('booksData = local; catalogLocalBooks = local; catalogHasLocalCache = true; catalogAcceptedSignature = catalogSignature(old); hasUnsavedAdminChanges = false;');
  unsavedDraft.run('applyCloudCatalogSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ booksData: old }) });');
  assert.equal(unsavedDraft.run('catalogLoadState'), 'ready');
  assert.equal(unsavedDraft.run('booksData.some(book => book.code === "999")'), true, 'server echo cannot discard draft');
  assert.equal(unsavedDraft.run('hasUnsavedAdminChanges'), true, 'reload must restore unsaved flag from baseline');

  const incognito = createApp();
  incognito.sandbox.old = old;
  incognito.run('booksData = INITIAL_BOOKS; catalogLocalBooks = booksData; catalogHasLocalCache = false;');
  incognito.run('applyCloudCatalogSnapshot({ exists: false, metadata: { fromCache: false }, data: () => null });');
  assert.equal(incognito.run('catalogLoadState'), 'missing');
  assert.equal(incognito.run('booksData.length'), 76, 'missing server document must not turn initial books into official data');

  const failed = createApp();
  failed.sandbox.local = local;
  failed.sandbox.mockDb = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) };
  failed.run('booksData = local; firestoreDb = mockDb;');
  await failed.run('refreshCatalogFromServer()');
  assert.equal(failed.run('catalogLoadState'), 'failed');
  assert.equal(failed.run('booksData.some(book => book.code === "999")'), true);

  const conflict = createApp();
  conflict.sandbox.old = old;
  conflict.sandbox.local = local;
  conflict.sandbox.other = [...old, { id: 888, code: '888', title: '別台新增' }];
  conflict.sandbox.mockDb = {
    runTransaction: callback => callback({
      get: async () => ({ exists: true, data: () => ({ booksData: conflict.sandbox.other }) }),
      set: () => { throw new Error('should not write'); }
    }),
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, metadata: { fromCache: false }, data: () => ({ booksData: conflict.sandbox.other }) }) }) })
  };
  conflict.run('booksData = local; catalogLocalBooks = local; catalogServerBooks = old; catalogHasLocalCache = true; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; cloudReady = true; currentUser = {uid: "admin"}; firestoreDb = mockDb;');
  await assert.rejects(conflict.run('saveCurrentSemesterToCloud()'), /其他裝置修改/);
  assert.equal(conflict.run('catalogLoadState'), 'review');
  assert.equal(conflict.run('booksData.some(book => book.code === "999")'), true);

  function configuredSave(teacherDocs) {
    const test = createApp();
    test.sandbox.old = old;
    test.sandbox.local = local;
    let committed = old;
    test.sandbox.mockDb = {
      runTransaction: async callback => callback({
        get: async () => ({ exists: true, data: () => ({ booksData: committed }) }),
        set: (_ref, data) => { committed = data.booksData; }
      }),
      waitForPendingWrites: async () => {},
      collection: name => name === 'teacherBooks'
        ? { where: () => ({ get: async () => ({ size: teacherDocs.length, docs: teacherDocs }) }) }
        : { doc: () => ({ get: async () => ({ exists: true, data: () => ({ booksData: committed }) }), set: async () => {} }) }
    };
    test.run('booksData = local; catalogLocalBooks = local; catalogServerBooks = old; catalogHasLocalCache = true; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; cloudReady = true; hasUnsavedAdminChanges = true; currentUser = {uid: "admin"}; firestoreDb = mockDb; getTeacherSelectionSemesterId = () => "115-1"; publishTeacherSelectionData = async () => {}; getSemesterDocument = () => ({ set: async () => {} });');
    return test;
  }
  const teacherDocs = local.map(book => ({
    id: `115-1_${book.code}`,
    data: () => ({ semesterId: '115-1', code: book.code, title: book.title, total: book.total, available: true })
  }));
  const success = configuredSave(teacherDocs);
  await success.run('saveCurrentSemesterToCloud()');
  assert.equal(success.run('hasUnsavedAdminChanges'), false);
  assert.equal(success.run('cloudSyncStatus'), 'saved');
  const noSettings = configuredSave(teacherDocs);
  noSettings.run('adminSettingsLoadState = "missing";');
  await assert.rejects(noSettings.run('saveCurrentSemesterToCloud()'), /學期設定/);
  assert.equal(noSettings.run('hasUnsavedAdminChanges'), true);
  const writeFailure = configuredSave(teacherDocs);
  writeFailure.sandbox.mockDb.runTransaction = async () => { throw new Error('permission denied'); };
  await assert.rejects(writeFailure.run('saveCurrentSemesterToCloud()'), /permission denied/);
  assert.equal(writeFailure.run('hasUnsavedAdminChanges'), true);
  assert.equal(writeFailure.run('cloudSyncStatus'), 'failed');
  const teacherFailure = configuredSave(teacherDocs.slice(0, 1));
  await assert.rejects(teacherFailure.run('saveCurrentSemesterToCloud()'), /教師端書目/);
  assert.equal(teacherFailure.run('hasUnsavedAdminChanges'), true, 'partial publish must not claim success');
  assert.equal(teacherFailure.run('cloudSyncStatus'), 'failed');

  console.log('catalog sync scenarios passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
