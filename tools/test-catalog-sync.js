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
      textContent: '', innerHTML: '', value: '', dataset: {}, querySelectorAll: () => [], setAttribute() {},
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
  app.run('booksData = local; catalogLocalBooks = local; catalogHasLocalCache = true; catalogLoadState = "loading"; cloudSyncStatus = "idle"; currentActiveTab = "home"; adminConfirmationFontLoaded = true;');
  assert.match(app.run('getCloudSyncState().text'), /尚未取得正式清冊/);

  app.run('applyCloudCatalogSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ booksData: old }) });');
  assert.equal(app.run('catalogLoadState'), 'review');
  assert.equal(app.elements.get('catalog-source-status').textContent, '', 'the confirmation page stays blank until every source is ready');
  assert.equal(app.elements.get('catalog-source-summary').textContent, '', 'a partial snapshot must not show the old catalog summary');
  app.run('adminSettingsLoadState = "ready"; semesterLoadState = "ready"; teacherSelectionWindowLoaded = true; teacherSelectionWindowLoadError = ""; teacherSelectionRecordsLoaded = true; teacherSelectionRecordsLoadError = ""; renderCatalogSource();');
  assert.match(app.elements.get('catalog-source-status').textContent, /目前書箱清冊與 Firestore 正式資料不同/);
  assert.match(app.elements.get('catalog-source-summary').textContent, /正式清冊 1 本，最後編號 99/);
  assert.match(app.elements.get('catalog-merge-rows').innerHTML, /書箱999號/);
  assert.equal(app.run('booksData.some(book => book.code === "999")'), true, 'server snapshot must retain local 999');
  app.run('applyCatalogMerge();');
  assert.equal(app.run('catalogLoadState'), 'ready');
  assert.equal(app.run('booksData.some(book => book.code === "999")'), true, 'default merge keeps local-only book');
  assert.equal(app.run('hasUnsavedAdminChanges'), true);

  const confirmed = createApp();
  confirmed.sandbox.old = old;
  confirmed.run('booksData = old; catalogLocalBooks = old; catalogServerBooks = old; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; semesterLoadState = "ready"; teacherSelectionWindowLoaded = true; teacherSelectionWindowLoadError = ""; teacherSelectionRecordsLoaded = true; teacherSelectionRecordsLoadError = ""; catalogServerSystemDataUploadedAt = "2026/9/16 上午10:58:39"; renderCatalogSource();');
  assert.equal(confirmed.elements.get('catalog-source-status').textContent, '① 已從 Firestore 伺服器讀取正式清冊。');
  assert.equal(confirmed.elements.get('catalog-source-summary').textContent, '② 正式清冊 1 本，最後編號 99（缺號 0，共 30 本）。');
  assert.equal(confirmed.elements.get('catalog-source-updated-at').textContent, '③ 系統資料寫入雲端時間 2026/9/16 上午10:58:39。');
  assert.match(confirmed.elements.get('catalog-source-updated-at').innerHTML, /catalog-confirmation-upload-time/);
  assert.equal(confirmed.elements.get('catalog-source-semester-summary').textContent, '④ 學期設定已確認（班級、輪換安排）。');
  assert.equal(confirmed.elements.get('catalog-source-detail').textContent, '⑤ 選書設定已確定（開放時段、選書內容）。');

  const fontPending = createApp();
  fontPending.sandbox.old = old;
  fontPending.run('booksData = old; catalogLocalBooks = old; catalogServerBooks = old; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; semesterLoadState = "ready"; teacherSelectionWindowLoaded = true; teacherSelectionWindowLoadError = ""; teacherSelectionRecordsLoaded = true; teacherSelectionRecordsLoadError = ""; currentActiveTab = "home"; adminConfirmationFontLoaded = false; renderCatalogSource();');
  assert.equal(fontPending.elements.get('catalog-source-status').textContent, '① 已從 Firestore 伺服器讀取正式清冊。', 'the confirmation page must not wait for the decorative font');

  const lastBoxOnly = createApp();
  lastBoxOnly.sandbox.multiBoxCatalog = [
    { id: 1, code: '1', title: '第一箱', total: '20', maxNum: '20', missing: '2, 8' },
    { id: 99, code: '99', title: '最後一箱', total: '28', maxNum: '30', missing: '4, 18' }
  ];
  lastBoxOnly.run('booksData = multiBoxCatalog; catalogLocalBooks = multiBoxCatalog; catalogServerBooks = multiBoxCatalog; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; semesterLoadState = "ready"; teacherSelectionWindowLoaded = true; teacherSelectionRecordsLoaded = true; renderCatalogSource();');
  assert.equal(lastBoxOnly.elements.get('catalog-source-summary').textContent, '② 正式清冊 2 本，最後編號 99（缺號 2，共 28 本）。');

  confirmed.run('semesterLoadState = "review"; renderCatalogSource();');
  assert.equal(confirmed.elements.get('catalog-source-status').textContent, '① 目前學期設定與 Firestore 正式資料不同；請在下方直接比對。');
  assert.equal(confirmed.elements.get('catalog-source-summary').textContent, '② 正式清冊 1 本，最後編號 99（缺號 0，共 30 本）。');
  assert.equal(confirmed.elements.get('catalog-source-updated-at').textContent, '③ 系統資料寫入雲端時間 2026/9/16 上午10:58:39。');
  assert.equal(confirmed.elements.get('catalog-source-detail').textContent, '⑤ 選書設定已確定（開放時段、選書內容）。');

  confirmed.run('semesterLoadState = "ready"; adminDataConfirmationComplete = true; hasUnsavedAdminChanges = true; renderCatalogSource();');
  assert.equal(confirmed.run('adminDataConfirmationComplete'), true, 'own unsaved draft must not revoke the completed gate');
  confirmed.run('hasUnsavedAdminChanges = false; catalogLoadState = "review"; currentActiveTab = "home"; renderCatalogSource();');
  assert.equal(confirmed.run('adminDataConfirmationComplete'), false, 'a catalog conflict must revoke the completed gate');

  const serverSemester = {
    gradeCounts: { g7: 1, g8: 1 },
    rotationDates: {},
    rotationSchedule: {
      '701': { p1: null, p2: null, p3: null },
      '801': { p1: null, p2: null, p3: null }
    },
    grade8HistoryBooks: {}
  };
  const adoptSemesterServer = createApp();
  adoptSemesterServer.sandbox.old = old;
  adoptSemesterServer.sandbox.serverSemester = serverSemester;
  adoptSemesterServer.run('switchTab = tab => { currentActiveTab = tab; }; booksData = old; catalogLocalBooks = old; catalogServerBooks = old; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; teacherSelectionWindowLoaded = true; teacherSelectionWindowLoadError = ""; teacherSelectionRecordsLoaded = true; teacherSelectionRecordsLoadError = ""; currentSemester = "115-1"; gradeCounts = { g7: 2, g8: 1 }; rotationDates = {}; rotationSchedule = {}; grade8HistoryBooks = {}; semesterLocalData = buildCurrentSemesterSavePayload(); semesterServerData = serverSemester; semesterHasLocalCache = true; semesterLoadState = "review"; hasUnsavedAdminChanges = true; unsavedChangesSemesterId = currentSemester; applySemesterMerge();');
  assert.equal(adoptSemesterServer.run('semesterLoadState'), 'ready');
  assert.equal(adoptSemesterServer.run('hasUnsavedAdminChanges'), false, 'all-server semester merge discards the semester draft');
  assert.equal(adoptSemesterServer.run('unsavedChangesSemesterId'), '');
  assert.equal(adoptSemesterServer.run('semesterSignature(semesterLocalData) === semesterSignature(semesterServerData)'), true);
  assert.equal(adoptSemesterServer.run('isAdminDataConfirmationReady()'), true, 'all-server merge can enter the workspace without saving');
  assert.equal(adoptSemesterServer.run('adminDataConfirmationComplete'), true, 'all-server semester merge must enter the workspace directly');
  adoptSemesterServer.run('adminDataConfirmationComplete = true; currentActiveTab = "catalog"; applySemesterCloudSnapshot({ exists: true, metadata: { hasPendingWrites: false }, data: () => serverSemester });');
  assert.equal(adoptSemesterServer.run('semesterLoadState'), 'ready', 'the matching server snapshot must not reopen review');
  assert.equal(adoptSemesterServer.run('adminDataConfirmationComplete'), true, 'the matching server snapshot must not send the admin back to confirmation');

  const semanticLocalSemester = {
    gradeCounts: { g7: '12', g8: 12, isConfigured: true },
    rotationDates: { returnDate: '2027-01-20', issueDate: '2026-09-01', ignoredLegacyDate: 'ignore me' },
    rotationSchedule: {
      '701': {
        p2: { code: 2, fromPlace: '衍生欄位', dueDate: '2026-10-01' },
        p1: { code: 1, isSpecified: true, toPlace: '衍生欄位' }
      },
      '702': {}
    },
    grade8HistoryBooks: { '801': [2, '1', '2'], '802': [] }
  };
  const semanticServerSemester = {
    gradeCounts: { g8: '12', g7: 12 },
    rotationDates: { issueDate: '2026-09-01', returnDate: '2027-01-20' },
    rotationSchedule: {
      '701': {
        p1: { code: '1', isSpecified: true },
        p2: { code: '2' }
      }
    },
    grade8HistoryBooks: { '801': ['1', '2'] }
  };
  const semanticParity = createApp();
  semanticParity.sandbox.semanticLocalSemester = semanticLocalSemester;
  semanticParity.sandbox.semanticServerSemester = semanticServerSemester;
  assert.equal(semanticParity.run('semesterSignature(semanticLocalSemester) === semesterSignature(semanticServerSemester)'), true, 'legacy flags, numeric strings, key order, derived fields, and duplicate history must not create a conflict');
  assert.equal(semanticParity.run('getSemesterDifferences(semanticLocalSemester, semanticServerSemester).length'), 0);

  const meaningfulLocalSemester = JSON.parse(JSON.stringify(semanticServerSemester));
  const meaningfulServerSemester = JSON.parse(JSON.stringify(semanticServerSemester));
  meaningfulServerSemester.gradeCounts.g7 = 13;
  meaningfulServerSemester.rotationDates.returnDate = '2027-01-21';
  meaningfulServerSemester.rotationSchedule['701'].p2.code = '9';
  meaningfulServerSemester.grade8HistoryBooks['801'] = ['1', '3'];
  const meaningfulDiff = createApp();
  meaningfulDiff.sandbox.meaningfulLocalSemester = meaningfulLocalSemester;
  meaningfulDiff.sandbox.meaningfulServerSemester = meaningfulServerSemester;
  assert.equal(meaningfulDiff.run('semesterSignature(meaningfulLocalSemester) === semesterSignature(meaningfulServerSemester)'), false);
  assert.deepEqual(
    JSON.parse(meaningfulDiff.run('JSON.stringify(getSemesterDifferences(meaningfulLocalSemester, meaningfulServerSemester))')),
    [
      { key: 'gradeCounts', label: '班級數設定', details: [{ label: '七年級班數', local: 12, server: 13 }] },
      { key: 'rotationDates', label: '輪換日期', details: [{ label: '歸還日', local: '2027-01-20', server: '2027-01-21' }] },
      { key: 'rotationSchedule', label: '輪換安排', details: [{ label: '701 班第二次輪換', local: '2 號書箱', server: '9 號書箱' }] },
      { key: 'grade8HistoryBooks', label: '七、八年級閱讀紀錄', details: [{ label: '801 班閱讀紀錄', local: '1 號、2 號', server: '1 號、3 號' }] }
    ],
    'every meaningful difference must identify its field and both values'
  );
  meaningfulDiff.run('gradeCounts = meaningfulLocalSemester.gradeCounts; rotationDates = meaningfulLocalSemester.rotationDates; rotationSchedule = meaningfulLocalSemester.rotationSchedule; grade8HistoryBooks = meaningfulLocalSemester.grade8HistoryBooks; semesterLocalData = buildCurrentSemesterSavePayload(); semesterHasLocalCache = true; applySemesterCloudSnapshot({ exists: true, metadata: { hasPendingWrites: false }, data: () => meaningfulServerSemester });');
  assert.equal(meaningfulDiff.run('semesterLoadState'), 'review', 'meaningful differences must still enter the merge flow');

  const mixedSemesterMerge = createApp();
  mixedSemesterMerge.sandbox.old = old;
  mixedSemesterMerge.sandbox.serverSemester = serverSemester;
  mixedSemesterMerge.run('booksData = old; catalogLocalBooks = old; catalogServerBooks = old; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; currentSemester = "115-1"; gradeCounts = { g7: 2, g8: 1 }; rotationDates = {}; rotationSchedule = {}; grade8HistoryBooks = {}; semesterLocalData = buildCurrentSemesterSavePayload(); semesterServerData = serverSemester; semesterHasLocalCache = true; semesterLoadState = "review"; semesterMergeChoices.set("gradeCounts", "local"); applySemesterMerge();');
  assert.equal(mixedSemesterMerge.run('semesterLoadState'), 'ready');
  assert.equal(mixedSemesterMerge.run('hasUnsavedAdminChanges'), true, 'a mixed merge remains an unsaved local change');
  assert.equal(mixedSemesterMerge.run('unsavedChangesSemesterId'), '115-1');

  const catalogDraftWithServerSemester = createApp();
  catalogDraftWithServerSemester.sandbox.old = old;
  catalogDraftWithServerSemester.sandbox.local = local;
  catalogDraftWithServerSemester.sandbox.serverSemester = serverSemester;
  catalogDraftWithServerSemester.run('booksData = local; catalogLocalBooks = local; catalogServerBooks = old; catalogLoadState = "ready"; adminSettingsLoadState = "ready"; currentSemester = "115-1"; gradeCounts = { g7: 2, g8: 1 }; rotationDates = {}; rotationSchedule = {}; grade8HistoryBooks = {}; semesterLocalData = buildCurrentSemesterSavePayload(); semesterServerData = serverSemester; semesterHasLocalCache = true; semesterLoadState = "review"; hasUnsavedAdminChanges = true; unsavedChangesSemesterId = currentSemester; applySemesterMerge();');
  assert.equal(catalogDraftWithServerSemester.run('semesterLoadState'), 'ready');
  assert.equal(catalogDraftWithServerSemester.run('hasUnsavedAdminChanges'), true, 'an independent catalog draft remains pending');
  assert.equal(catalogDraftWithServerSemester.run('unsavedChangesSemesterId'), '', 'the accepted semester must not remain marked as a draft');

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
  await failed.run('loadCatalogFromServer()');
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

  const confirmationSave = createApp();
  confirmationSave.run(`
    currentActiveTab = 'home';
    adminDataConfirmationComplete = false;
    hasUnsavedAdminChanges = true;
    cloudReady = true;
    catalogLoadState = 'ready';
    adminSettingsLoadState = 'ready';
    semesterLoadState = 'ready';
    teacherSelectionWindowLoaded = true;
    teacherSelectionRecordsLoaded = true;
    saveCurrentSemesterToCloud = async () => { hasUnsavedAdminChanges = false; };
    renderAdminSavePopover = () => {};
    enterAdminWorkspace = () => {
      adminDataConfirmationComplete = true;
      currentActiveTab = 'catalog';
    };
  `);
  await confirmationSave.run('confirmAdminSave()');
  assert.equal(confirmationSave.run('adminDataConfirmationComplete'), true, 'a successful confirmation-page save must complete the gate');
  assert.equal(confirmationSave.run('currentActiveTab'), 'catalog', 'a successful confirmation-page save must enter the catalog');

  const workspaceSave = createApp();
  workspaceSave.run(`
    currentActiveTab = 'catalog';
    adminDataConfirmationComplete = true;
    hasUnsavedAdminChanges = true;
    cloudReady = true;
    catalogLoadState = 'ready';
    adminSettingsLoadState = 'ready';
    semesterLoadState = 'ready';
    teacherSelectionWindowLoaded = true;
    teacherSelectionRecordsLoaded = true;
    saveCurrentSemesterToCloud = async () => { hasUnsavedAdminChanges = false; };
    renderAdminSavePopover = () => {};
    enterAdminWorkspace = () => { throw new Error('workspace save must not navigate'); };
  `);
  await workspaceSave.run('confirmAdminSave()');
  assert.equal(workspaceSave.run('currentActiveTab'), 'catalog', 'a workspace save must keep its current page');

  const confirmationFailure = createApp();
  confirmationFailure.run(`
    currentActiveTab = 'home';
    adminDataConfirmationComplete = false;
    hasUnsavedAdminChanges = true;
    cloudReady = true;
    catalogLoadState = 'ready';
    adminSettingsLoadState = 'ready';
    saveCurrentSemesterToCloud = async () => { throw new Error('offline'); };
    renderAdminSavePopover = () => {};
    enterAdminWorkspace = () => { throw new Error('failed save must not navigate'); };
  `);
  await confirmationFailure.run('confirmAdminSave()');
  assert.equal(confirmationFailure.run('currentActiveTab'), 'home', 'a failed confirmation-page save must remain on the confirmation page');
  assert.equal(confirmationFailure.run('hasUnsavedAdminChanges'), true, 'a failed confirmation-page save must retain unsaved changes');

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
