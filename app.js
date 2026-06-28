/* =========================================================================
   SAA 模試トレーナー  app.js
   - 問題はインポート(CSV)して端末内(localStorage)のみに保存。ネット送信なし。
   - 試験モード / 解説モード / 正答率記録 / ジャンル分け / 弱点エクスポート
   ========================================================================= */
(function () {
'use strict';

/* ---------- 小道具 ---------- */
var app = document.getElementById('app');
var $ = function (sel, root) { return (root || document).querySelector(sel); };
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function fmtDate(ms) {
  var d = new Date(ms);
  function z(n){return (n<10?'0':'')+n;}
  return d.getFullYear()+'/'+z(d.getMonth()+1)+'/'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes());
}
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + '分' + (s < 10 ? '0' : '') + s + '秒';
}
function toast(msg) {
  var t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 1800);
  setTimeout(function () { t.remove(); }, 2300);
}
function eqSet(a, b) {
  if (a.length !== b.length) return false;
  var sa = a.slice().sort(), sb = b.slice().sort();
  for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}
function shuffle(arr) {
  arr = arr.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ---------- ストレージ(localStorage) ---------- */
var LS = {
  get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del: function (k) { localStorage.removeItem(k); }
};
var Store = {
  deckIds: function () { return LS.get('saa.deckIndex', []); },
  getDeck: function (id) { return LS.get('saa.deck.' + id, null); },
  saveDeck: function (d) {
    var ids = this.deckIds();
    if (ids.indexOf(d.id) < 0) { ids.push(d.id); LS.set('saa.deckIndex', ids); }
    if (!LS.set('saa.deck.' + d.id, d)) {
      toast('保存容量が不足しています。古いデッキを削除してください');
      throw new Error('quota');
    }
    if (Sync) Sync.pushDeck(d.id);
  },
  delDeck: function (id) {
    LS.del('saa.deck.' + id); LS.del('saa.attempts.' + id);
    LS.set('saa.deckIndex', this.deckIds().filter(function (x) { return x !== id; }));
    if (ActiveDeck.get() === id) ActiveDeck.set('__all__');
    if (Sync) Sync.delDeck(id);
  },
  decks: function () { return this.deckIds().map(function (id) { return Store.getDeck(id); }).filter(Boolean); },
  attempts: function (id) { return LS.get('saa.attempts.' + id, []); },
  addAttempt: function (id, a) { var arr = this.attempts(id); a.id = Date.now(); arr.push(a); LS.set('saa.attempts.' + id, arr); if (Sync) Sync.pushAttempt(id, a); return a; }
};

/* ---------- アクティブデッキ（端末ごとのUI設定。サーバー同期しない） ---------- */
var ActiveDeck = {
  all: '__all__',
  get: function () {
    var id = LS.get('saa.activeDeck', ActiveDeck.all);
    if (!id || (id !== ActiveDeck.all && !Store.getDeck(id))) {
      id = ActiveDeck.all;
      LS.set('saa.activeDeck', id);
    }
    return id;
  },
  set: function (id) {
    if (!id || id === ActiveDeck.all || !Store.getDeck(id)) id = ActiveDeck.all;
    LS.set('saa.activeDeck', id);
    updateDeckChip();
  },
  deckId: function () {
    var id = ActiveDeck.get();
    return id === ActiveDeck.all ? '' : id;
  },
  label: function () {
    var id = ActiveDeck.get();
    if (id === ActiveDeck.all) return '全デッキ';
    var d = Store.getDeck(id);
    return d ? deckLabel(d.name) : '全デッキ';
  },
  preferred: function (fallback) {
    var id = ActiveDeck.get();
    if (id !== ActiveDeck.all && Store.getDeck(id)) return id;
    if (fallback && Store.getDeck(fallback)) return fallback;
    var decks = Store.decks();
    return decks.length ? decks[0].id : '';
  }
};
function activeDeckOptions(cur) {
  var opts = '<option value="' + ActiveDeck.all + '"' + (cur === ActiveDeck.all ? ' selected' : '') + '>全デッキ</option>';
  Store.decks().forEach(function (d) {
    opts += '<option value="' + esc(d.id) + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(deckLabel(d.name)) + '（' + d.count + '問）</option>';
  });
  return opts;
}
function activeDeckCard(decks) {
  if (!decks.length) return '';
  var cur = ActiveDeck.get();
  return '<div class="card active-deck-card" id="activeDeckCard">' +
    '<div class="row"><div class="grow"><h3 style="margin:0">📚 今使うデッキ</h3>' +
    '<div class="small muted">試験・練習・解説・弱点・今日の宿題の既定値になります。</div></div></div>' +
    '<label class="fld"><span class="lab">デッキ</span><select id="activeDeckSel">' + activeDeckOptions(cur) + '</select></label>' +
    '</div>';
}
function initDeckChip() {
  var top = document.querySelector('header.top');
  if (!top || document.getElementById('activeDeckChip')) return;
  var b = document.createElement('button');
  b.id = 'activeDeckChip';
  b.className = 'deck-chip';
  b.type = 'button';
  b.title = '今使うデッキ';
  b.addEventListener('click', function () { show('home'); });
  top.insertBefore(b, document.getElementById('installBtn'));
  updateDeckChip();
}
function updateDeckChip() {
  var b = document.getElementById('activeDeckChip');
  if (!b) return;
  if (!Store.decks().length) { b.style.display = 'none'; return; }
  b.style.display = 'inline-flex';
  b.textContent = '📚 ' + ActiveDeck.label();
}

/* ---------- ブックマーク（★） ---------- */
var BM = {
  list: function (deckId) { return LS.get('saa.bm.' + deckId, []); },
  has: function (deckId, num) { return BM.list(deckId).indexOf(num) >= 0; },
  toggle: function (deckId, num) {
    var a = BM.list(deckId), i = a.indexOf(num);
    if (i >= 0) a.splice(i, 1); else a.push(num);
    LS.set('saa.bm.' + deckId, a); if (Sync) Sync.pushProgress(deckId, num); return i < 0;
  }
};

/* ---------- 設定（文字サイズ） ---------- */
var Settings = {
  get: function () { return LS.get('saa.settings', { font: 1 }); },
  set: function (s) { LS.set('saa.settings', s); },
  applyFont: function () {
    var f = Settings.get().font || 1;
    document.documentElement.style.fontSize = (f === 0 ? 14 : f === 2 ? 18.5 : 16) + 'px';
  }
};

/* ---------- アプリ内で追記する解説（端末内保存） ---------- */
var ExplStore = {
  all: function (deckId) { return LS.get('saa.expl.' + deckId, {}); },
  get: function (deckId, num) { return ExplStore.all(deckId)[num]; },
  set: function (deckId, num, text) {
    var m = ExplStore.all(deckId);
    if (text && text.trim()) m[num] = text; else delete m[num];
    LS.set('saa.expl.' + deckId, m);
    if (Sync) Sync.pushProgress(deckId, num);
  },
  count: function (deckId) { return Object.keys(ExplStore.all(deckId)).length; }
};
/* ---------- 自信度＋思ったことメモ（端末内保存。Phase2でサーバー同期） ---------- */
var CONF_MARKS = ['◎', '○', '△', '×'];
var CONF_LABEL = { '◎': '確信', '○': 'たぶん', '△': '勘', '×': 'わからない' };
function normConf(c) { return ({ '〇': '○', '✕': '×', 'x': '×', 'X': '×', 'ｘ': '×' })[c] || c; }
var CONF = {
  all: function (deckId) { return LS.get('saa.conf.' + deckId, {}); },
  get: function (deckId, num) { return CONF.all(deckId)[num] || null; },
  _save: function (deckId, num, e) {
    var m = CONF.all(deckId);
    if (e && (e.c || e.m)) m[num] = e; else delete m[num];
    LS.set('saa.conf.' + deckId, m);
    if (Sync) Sync.pushProgress(deckId, num); // サーバー同期（未ログインなら無視）
  },
  setConf: function (deckId, num, c) {
    var e = CONF.get(deckId, num) || {};
    if (c) e.c = c; else delete e.c;
    CONF._save(deckId, num, e);
  },
  setMemo: function (deckId, num, text) {
    var e = CONF.get(deckId, num) || {};
    text = (text || '').trim();
    if (text) e.m = text; else delete e.m;
    CONF._save(deckId, num, e);
  },
  count: function (deckId) { return Object.keys(CONF.all(deckId)).length; }
};
/* 自信度セレクタ＋メモ欄（試験・解説の両モードで共用） */
function confSectionHtml(deckId, q) {
  var cur = CONF.get(deckId, q.num) || {};
  var btns = CONF_MARKS.map(function (mk, i) {
    return '<button class="conf-btn' + (cur.c === mk ? ' on c' + i : '') + '" data-act="confSet" data-num="' + q.num +
      '" data-c="' + mk + '" title="' + CONF_LABEL[mk] + '">' + mk + '</button>';
  }).join('');
  return '<div class="conf-wrap">' +
    '<div class="conf-row"><span class="conf-lab">自信度</span><div class="conf-sel">' + btns +
    '<button class="conf-btn clr' + (cur.c ? '' : ' on') + '" data-act="confSet" data-num="' + q.num + '" data-c="">クリア</button>' +
    '</div></div>' +
    '<textarea class="conf-memo" id="confMemo-' + q.num + '" data-num="' + q.num + '" rows="2" ' +
    'placeholder="思ったことメモ（例: AかDで迷った／Cはなぜ違う？）">' + esc(cur.m || '') + '</textarea>' +
    '</div>';
}
/* メモ欄(textarea)の保存（blur時）を結びつける。試験・解説の描画後に呼ぶ */
function bindConfInputs(deckId) {
  var tas = app.querySelectorAll('.conf-memo');
  for (var i = 0; i < tas.length; i++) {
    (function (ta) {
      ta.addEventListener('change', function () { CONF.setMemo(deckId, parseInt(ta.dataset.num, 10), ta.value); });
    })(tas[i]);
  }
}

/* ---------- 間隔反復（軽量Leitner：今日の宿題用） ---------- */
function ymdLocal(d) { function z(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
var SRS = {
  all: function (id) { return LS.get('saa.srs.' + id, {}); },
  get: function (id, num) { return SRS.all(id)[num] || null; },
  set: function (id, num, e) { var m = SRS.all(id); if (e) m[num] = e; else delete m[num]; LS.set('saa.srs.' + id, m); if (Sync) Sync.pushProgress(id, num); },
  grade: function (id, num, correct) {
    var e = SRS.get(id, num) || {}; var box = correct ? Math.min((e.box || 0) + 1, 5) : 1;
    var days = [0, 1, 2, 4, 8, 16][box] || 16;
    SRS.set(id, num, { box: box, due: Date.now() + days * 864e5, last: correct ? 'o' : 'x', lastDay: ymdLocal(new Date()) });
  }
};

/* ---------- サーバーAPI（同一オリジン。未ログイン/サーバー無しならローカルのみで動作） ---------- */
var API = {
  available: null,                          // /api 到達可否（null=未判定, true=あり, false=なし）
  token: function () { return LS.get('saa.token', ''); },
  setToken: function (t) { if (t) LS.set('saa.token', t); else LS.del('saa.token'); },
  req: function (method, p, body) {
    var h = { 'Content-Type': 'application/json' }; var tk = API.token(); if (tk) h.Authorization = 'Bearer ' + tk;
    return fetch('/api' + p, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      if (r.status === 401) { API.setToken(''); var e = new Error('unauthorized'); e.code = 401; throw e; }
      if (!r.ok) { var e2 = new Error('http ' + r.status); e2.code = r.status; throw e2; }
      return r.status === 204 ? null : r.json();
    });
  },
  login: function (pw) { return API.req('POST', '/login', { password: pw }).then(function (d) { API.setToken(d.token); return d; }); },
  getDecks: function () { return API.req('GET', '/decks'); },
  getDeck: function (id) { return API.req('GET', '/decks/' + encodeURIComponent(id)); },
  putDeck: function (d) { return API.req('PUT', '/decks/' + encodeURIComponent(d.id), d); },
  delDeck: function (id) { return API.req('DELETE', '/decks/' + encodeURIComponent(id)); },
  getProgress: function (id) { return API.req('GET', '/progress?deck=' + encodeURIComponent(id)); },
  putProgress: function (id, num, o) { return API.req('PUT', '/progress/' + encodeURIComponent(id) + '/' + num, o); },
  getAttempts: function (id) { return API.req('GET', '/attempts?deck=' + encodeURIComponent(id)); },
  homework: function (n, deckId) {
    var p = '/homework/today?n=' + (n || 10);
    if (deckId) p += '&deck=' + encodeURIComponent(deckId);
    return API.req('GET', p);
  }
};

/* ---------- 同期（localStorageをキャッシュ、サーバーを正）＋オフラインoutbox ---------- */
var Sync = {
  suppress: false,
  online: function () { return API.available && !!API.token(); },
  pushProgress: function (id, num) {
    if (!Sync.online() || Sync.suppress) return;
    var c = CONF.get(id, num) || {}, s = SRS.get(id, num) || {};
    Sync._send('PUT', '/progress/' + encodeURIComponent(id) + '/' + num, {
      conf: c.c || '', memo: c.m || '', bookmark: BM.has(id, num), expl: ExplStore.get(id, num) || '',
      box: s.box || 0, due: s.due || 0, last: s.last || '', lastDay: s.lastDay || ''
    }, 'p:' + id + ':' + num);
  },
  pushDeck: function (id) { if (!Sync.online() || Sync.suppress) return; var d = Store.getDeck(id); if (d) Sync._send('PUT', '/decks/' + encodeURIComponent(id), d, 'd:' + id); },
  pushAttempt: function (id, a) { if (!Sync.online() || Sync.suppress) return; Sync._send('POST', '/attempts', { deckId: id, attempt: a }, 'a:' + id + ':' + (a.id || Date.now())); },
  delDeck: function (id) { if (Sync.online()) API.delDeck(id).catch(function () {}); },
  _send: function (method, p, body, key) { API.req(method, p, body).catch(function (e) { if (e && e.code === 401) return; Sync._queue({ method: method, p: p, body: body, key: key }); }); },
  _queue: function (op) { var ob = LS.get('saa.outbox', []).filter(function (x) { return x.key !== op.key; }); ob.push(op); if (ob.length > 3000) ob = ob.slice(-3000); LS.set('saa.outbox', ob); },
  flushOutbox: function () {
    if (!Sync.online()) return Promise.resolve();
    var ob = LS.get('saa.outbox', []); if (!ob.length) return Promise.resolve();
    LS.set('saa.outbox', []);
    return ob.reduce(function (pr, op) { return pr.then(function () { return API.req(op.method, op.p, op.body).catch(function () { Sync._queue(op); }); }); }, Promise.resolve());
  },
  pullInto: function (list) {
    Sync.suppress = true;
    return (list ? Promise.resolve(list) : API.getDecks()).then(function (decks) {
      LS.set('saa.deckIndex', decks.map(function (d) { return d.id; }));
      return decks.reduce(function (pr, meta) {
        return pr.then(function () {
          return Promise.all([API.getDeck(meta.id), API.getProgress(meta.id), API.getAttempts(meta.id)]).then(function (r) {
            LS.set('saa.deck.' + meta.id, r[0] || { id: meta.id, name: meta.name, questions: [] });
            applyServerProgress(meta.id, r[1] || {});
            LS.set('saa.attempts.' + meta.id, r[2] || []);
          });
        });
      }, Promise.resolve());
    }).then(function () { Sync.suppress = false; }, function (e) { Sync.suppress = false; throw e; });
  },
  boot: function () {
    if (location.protocol === 'file:') { API.available = false; return show('home'); }
    API.getDecks().then(function (list) {
      API.available = true;
      Sync.pullInto(list).then(function () { Sync.flushOutbox(); show('home'); }, function () { show('home'); });
    }).catch(function (e) {
      if (e && e.code === 401) { API.available = true; show('login'); }
      else { API.available = false; show('home'); }    // サーバー無し＝従来のローカル動作
    });
  }
};
/* サーバーのprogress（{num:{conf,memo,bookmark,expl,box,due,last,lastDay}}）を各ローカルストアへ展開 */
function applyServerProgress(id, prog) {
  var conf = {}, bm = [], expl = {}, srs = {};
  Object.keys(prog || {}).forEach(function (num) {
    var e = prog[num] || {};
    if (e.conf || e.memo) { conf[num] = {}; if (e.conf) conf[num].c = e.conf; if (e.memo) conf[num].m = e.memo; }
    if (e.bookmark) bm.push(parseInt(num, 10));
    if (e.expl) expl[num] = e.expl;
    if (e.box || e.due || e.last) srs[num] = { box: e.box || 0, due: e.due || 0, last: e.last || '', lastDay: e.lastDay || '' };
  });
  LS.set('saa.conf.' + id, conf); LS.set('saa.bm.' + id, bm); LS.set('saa.expl.' + id, expl); LS.set('saa.srs.' + id, srs);
}
window.addEventListener('online', function () { Sync.flushOutbox(); });

/* ---------- ログイン画面 ---------- */
function renderLogin() {
  app.innerHTML = '<div class="card" style="margin-top:28px"><h3>🔒 ログイン</h3>' +
    '<p class="small muted">このサーバーの学習データ（問題・自信度メモ・成績）を見るにはパスワードが必要です。</p>' +
    '<label class="fld"><span class="lab">パスワード</span><input type="password" id="loginPw" autocomplete="current-password"></label>' +
    '<button class="btn primary block" data-act="doLogin">ログイン</button>' +
    '<button class="btn ghost block" data-act="openSchedule" style="margin-top:8px">学習スケジュールだけ見る</button>' +
    '<p class="small ngc" id="loginMsg" style="margin-top:8px"></p></div>';
  var pw = $('#loginPw'); if (pw) { pw.focus(); pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') handlers.doLogin(); }); }
}

/* ---------- 今日の宿題 ---------- */
var HW_N = 20;  // 今日の宿題の1日の問題数（固定）
var SCHEDULE_EXAM_DATE = '2026-07-14';
var STUDY_PLAN = [
  { date: '2026-06-24', shift: '休', theme: '現状整理＋◎思い込み7問', focus: 'Q21,24,25,48,55,59,62を正解理由まで言語化', target: 25 },
  { date: '2026-06-25', shift: 'A勤', theme: 'Cognito / IAM / Identity Center', focus: '認証・認可・ロール委任（仕事後・夜に学習）', target: 15 },
  { date: '2026-06-26', shift: '休', theme: 'ネットワーク集中（VPC/PrivateLink/NAT/Route53/CloudFront/WAF）', focus: '閉域接続・OAC・地理制限・DNS設計', target: 25 },
  { date: '2026-06-27', shift: 'C勤', theme: '軽め：◎思い込み7問の再確認', focus: '長時間勤務日。結論だけ音読', target: 6 },
  { date: '2026-06-28', shift: '休', theme: 'コンピュート集中（ASG/ALB/ECS/Lambda/Fargate）', focus: 'ターゲット追跡・Fargate・イベント駆動', target: 25 },
  { date: '2026-06-29', shift: 'B勤', theme: '疎結合（SQS FIFO/SNS/Step Functions）', focus: 'B勤＝少なめ。朝に短時間', target: 10 },
  { date: '2026-06-30', shift: '休', theme: 'ストレージ集中（S3/EBS/EFS/FSx）', focus: 'SSE強制・ライフサイクル・io2 Block Express', target: 25 },
  { date: '2026-07-01', shift: 'A勤', theme: 'DB（RDS/Aurora/DynamoDB/DAX）', focus: '整合性・キャッシュ・レプリカ（夜に学習）', target: 15 },
  { date: '2026-07-02', shift: 'A勤', theme: 'SG / NACL / セキュリティ', focus: 'ステートフル差・番号順・最小権限', target: 15 },
  { date: '2026-07-03', shift: 'A勤', theme: '移行/DMS/DataSync＋監視・コスト', focus: 'SCT・Direct Connect・Savings Plans', target: 15 },
  { date: '2026-07-04', shift: '休', theme: '模試1の誤答横断', focus: '思い込み優先で弱点ジャンル再演習', target: 25 },
  { date: '2026-07-05', shift: 'C勤', theme: '軽め：思い込み再確認＋苦手1ジャンル', focus: '長時間勤務日。無理しない', target: 6 },
  { date: '2026-07-06', shift: 'B勤', theme: '模試2の誤答横断（軽め）', focus: 'B勤＝少なめ。朝に短時間', target: 10 },
  { date: '2026-07-07', shift: '休', theme: '模試3の誤答横断（正誤修正後）', focus: '正解理由と不正解の切り分け', target: 25 },
  { date: '2026-07-08', shift: 'A勤', theme: '模試4の思い込み総復習', focus: '◎○で外した問題を自分の言葉で説明', target: 15 },
  { date: '2026-07-09', shift: '夜勤(1)', theme: '休養（勉強なし）', focus: '夜勤1日目。しっかり休む', target: 0 },
  { date: '2026-07-10', shift: '夜勤(2)', theme: '超軽め：◎7問の一言確認だけ', focus: '夜勤2日目。無理なら休んでOK', target: 5 },
  { date: '2026-07-11', shift: '休', theme: '夜勤明け回復＋弱点の軽い反復', focus: '体調最優先。残り誤答を軽く', target: 15 },
  { date: '2026-07-12', shift: '休', theme: '本番形式65問（模試リハ）', focus: '1問1.8分・迷ったら印を付けて先へ', target: 65 },
  { date: '2026-07-13', shift: 'A勤', theme: '前日仕上げ', focus: 'チートシート＋◎7問。夜は軽く早寝', target: 12 },
  { date: '2026-07-14', shift: '休', theme: '本番当日', focus: '朝は◎7問と型だけ。新規学習はしない', target: 0 }
];
function parseYmd(s) {
  var a = String(s || '').split('-');
  return new Date(parseInt(a[0], 10), parseInt(a[1], 10) - 1, parseInt(a[2], 10));
}
function daysUntilLocalDate(s) {
  var n = new Date();
  var today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.max(0, Math.ceil((parseYmd(s).getTime() - today.getTime()) / 864e5));
}
function jpDateLabel(s) {
  var d = parseYmd(s);
  var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + w + ')';
}
function reviewedCountOn(scopeId, day) {
  var ids = scopeId ? [scopeId] : Store.deckIds();
  var n = 0;
  ids.forEach(function (id) {
    var m = SRS.all(id);
    Object.keys(m || {}).forEach(function (num) { if (m[num] && m[num].lastDay === day) n++; });
  });
  return n;
}
function scheduleStats(scopeId) {
  var st = reviewStats(scopeId);
  var remain = Math.max(0, st.total - st.mastered);
  var days = Math.max(1, daysUntilLocalDate(SCHEDULE_EXAM_DATE));
  return { review: st, remain: remain, days: days, daily: remain ? Math.max(1, Math.ceil(remain / days)) : 0 };
}
function scheduleHomeCard() {
  var scope = ActiveDeck.deckId() ? ActiveDeck.label() : '全デッキ横断';
  var ss = scheduleStats(ActiveDeck.deckId());
  return '<div class="card schedule-card">' +
    '<div class="row"><div class="grow"><h3 style="margin:0">学習スケジュール</h3>' +
    '<div class="small muted">本番 2026/7/14 まで残り' + daysUntilLocalDate(SCHEDULE_EXAM_DATE) + '日・対象: <b>' + esc(scope) + '</b></div></div></div>' +
    '<div class="small" style="margin-top:8px">残り誤答 <b>' + ss.remain + '</b>問 / 今日の目安 <b>' + ss.daily + '</b>問</div>' +
    '<button class="btn primary block" data-act="openSchedule" style="margin-top:10px">スケジュールを見る</button></div>';
}
function homeHwCard() {
  var scope = ActiveDeck.deckId() ? ActiveDeck.label() : '全デッキ横断';
  var st = reviewStats(ActiveDeck.deckId());
  var rl = st.total ? '<div class="small" style="margin:0 0 8px">📚 誤答の見直し 残り <b>' + (st.total - st.mastered) + '</b> / ' + st.total + '（🔴思い込み残 ' + st.omoiRemain + '）</div>' : '';
  var todayLog = HwLog.get(ymdLocal(new Date()));
  var todayPctHtml = todayLog ? '<span class="hw-pct">本日 ' + todayLog.pct + '%</span>' : '';
  return '<div class="card" style="border-color:#1d4ed8">' +
    '<div class="row"><b class="grow">📅 今日の宿題</b>' +
    '<button class="btn ghost sm" data-act="syncNow">🔄 同期</button>' +
    '<button class="btn ghost sm" data-act="logout">ログアウト</button></div>' +
    '<p class="small muted" style="margin:6px 0">その日の弱点・思い込み・復習タイミングから自動出題。対象: <b>' + esc(scope) + '</b></p>' +
    '<div class="hw-total" style="margin:6px 0"><span class="hw-total-num">1日 全 ' + HW_N + ' 問</span>' + todayPctHtml + '</div>' + rl +
    '<button class="btn primary block" data-act="startHw">▶ 今日の宿題（TODO）を開く</button></div>';
}
/* 🎯 次の一手：状況から最適な1アクションを提示（迷う時間をなくす） */
function nextActionCard() {
  var st = reviewStats(ActiveDeck.deckId());
  if (!st.total) return '';
  var remain = st.total - st.mastered;
  var icon, title, desc, act, n, label;
  if (st.omoiRemain > 0) {
    icon = '🔴'; title = 'まず思い込みから'; desc = '自信があって外した最重要が ' + st.omoiRemain + ' 問。ここが一番伸びる。';
    act = 'quickFocus'; n = 3; label = '最重要を3問やる';
  } else if (remain > 0) {
    icon = '🎯'; title = '弱点を1つ減らそう'; desc = '未克服が ' + remain + ' 問。5問だけサクッと。';
    act = 'quickFocus'; n = 5; label = 'サクッと5問やる';
  } else {
    icon = '🎉'; title = '弱点は克服済み！'; desc = '維持のため、めくって復習を。';
    act = 'startFlash'; n = 0; label = 'ながら復習で維持';
  }
  return '<div class="card next-card">' +
    '<div class="row"><span class="next-ic">' + icon + '</span>' +
    '<div class="grow"><b style="font-size:17px">今これをやろう</b>' +
    '<div class="small" style="color:#e9d5ff">' + esc(title) + '</div></div></div>' +
    '<p class="small" style="margin:8px 0">' + esc(desc) + '</p>' +
    '<button class="btn primary block" data-act="' + act + '"' + (act === 'quickFocus' ? ' data-n="' + n + '"' : '') + '>▶ ' + esc(label) + '</button>' +
    '</div>';
}

/* 🔥 学習カレンダー：日々の学習量をヒートマップ＋連続日数で見える化 */
function studyDayCount(scopeId, dateStr) { return reviewedCountOn(scopeId, dateStr); }
function studyStreak(scopeId) {
  var d = new Date(); d.setHours(0, 0, 0, 0);
  var n = 0;
  // 今日が0でも昨日まで続いていれば継続中とみなす（今日分の猶予）
  if (studyDayCount(scopeId, ymdLocal(d)) === 0) d.setDate(d.getDate() - 1);
  while (studyDayCount(scopeId, ymdLocal(d)) > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function studyCalendarCard() {
  var scopeId = ActiveDeck.deckId();
  var base = new Date(); base.setHours(0, 0, 0, 0);
  var todayStr = ymdLocal(base);
  var sun = new Date(base); sun.setDate(base.getDate() - base.getDay());   // 今週の日曜
  var start = new Date(sun); start.setDate(sun.getDate() - 7 * 4);          // 5週間前の日曜
  var WK = ['日', '月', '火', '水', '木', '金', '土'];
  var headRow = WK.map(function (w) { return '<div class="cal-wd">' + w + '</div>'; }).join('');
  var cells = '', monthDays = 0, total = 0, anyData = false;
  for (var i = 0; i < 35; i++) {
    var dt = new Date(start); dt.setDate(start.getDate() + i);
    var ds = ymdLocal(dt);
    var future = dt > base;
    var cnt = future ? 0 : studyDayCount(scopeId, ds);
    if (cnt > 0) { anyData = true; total += cnt; if (dt.getMonth() === base.getMonth() && dt.getFullYear() === base.getFullYear()) monthDays++; }
    var lvl = future ? 'f' : (cnt === 0 ? '0' : (cnt >= 8 ? '3' : (cnt >= 4 ? '2' : '1')));
    var isToday = (ds === todayStr);
    cells += '<div class="cal-cell l' + lvl + (isToday ? ' today' : '') + '" title="' + ds + '：' + cnt + '問"><span>' + dt.getDate() + '</span></div>';
  }
  var streak = studyStreak(scopeId);
  return '<div class="card cal-card">' +
    '<div class="row"><b class="grow">🔥 学習カレンダー</b>' +
    '<span class="small muted">連続 <b style="color:#fdba74">' + streak + '</b> 日</span></div>' +
    '<div class="small muted" style="margin:4px 0 8px">直近5週間 ・ 今月 ' + monthDays + ' 日学習' + (anyData ? '' : '（まだ記録なし。今日から！）') + '</div>' +
    '<div class="cal-grid">' + headRow + cells + '</div>' +
    '<div class="cal-legend small muted">少 <span class="cal-cell l0"></span><span class="cal-cell l1"></span><span class="cal-cell l2"></span><span class="cal-cell l3"></span> 多</div>' +
    '</div>';
}

/* ⚡ サクッと集中カード（最重要から数問だけ・短時間）。誤答プールがあるときだけ表示 */
function quickFocusCard() {
  var st = reviewStats(ActiveDeck.deckId());
  if (!st.total) return '';
  var remain = st.total - st.mastered;
  if (remain <= 0) return '';
  var scope = ActiveDeck.deckId() ? ActiveDeck.label() : '全デッキ';
  return '<div class="card focus-card">' +
    '<div class="row"><b class="grow" style="font-size:18px">⚡ サクッと集中</b>' +
    '<span class="small muted">' + esc(scope) + '</span></div>' +
    '<p class="small" style="margin:6px 0 8px">集中が切れてもOK。<b>最重要（思い込み）から数問だけ</b>。1問ずつ即採点＋解説で、すぐ終わる。' +
    (st.omoiRemain ? '<br>🔴 思い込み残 <b>' + st.omoiRemain + '</b> 問 ／ 未克服 ' + remain + ' 問' : '<br>未克服 ' + remain + ' 問') + '</p>' +
    '<div class="btnrow">' +
    '<button class="btn primary grow" data-act="quickFocus" data-n="3">最重要 3問</button>' +
    '<button class="btn primary grow" data-act="quickFocus" data-n="5">最重要 5問</button>' +
    '<button class="btn grow" data-act="quickFocus" data-n="10">10問</button>' +
    '</div>' +
    '<div class="small muted" style="margin-top:6px">目安: 3問≈5分・5問≈8分・10問≈15分</div>' +
    '<button class="btn block" data-act="startFlash" style="margin-top:10px">🎮 ながら復習（めくるだけ）</button>' +
    '<div class="small muted" style="margin-top:4px">ゲームの合間にどうぞ。選ばず<b>タップ／スワイプでめくる</b>だけ。✓/△で弱点に反映。</div>' +
    '</div>';
}
var HwStreak = {
  get: function () { return LS.get('saa.hwStreak', { last: '', n: 0 }); },
  bump: function () {
    var s = HwStreak.get(), t = ymdLocal(new Date());
    if (s.last === t) return s.n;
    var y = ymdLocal(new Date(Date.now() - 864e5));
    s.n = (s.last === y) ? (s.n + 1) : 1; s.last = t;
    LS.set('saa.hwStreak', s); return s.n;
  }
};
/* 当日の宿題の進捗率を日付ごとに記録（端末内・直近60日保持）。グラフ/履歴表示用 */
var HwLog = {
  all: function () { return LS.get('saa.hwlog', {}); },
  record: function (done, total) {
    if (!total) return;
    var t = ymdLocal(new Date()), m = HwLog.all();
    var p = Math.round(done / total * 100);
    var cur = m[t];
    // その日の最大到達進捗を残す（再取得などで total が変わっても達成側を優先）
    if (!cur || done > (cur.done || 0) || p > (cur.pct || 0)) {
      m[t] = { done: done, total: total, pct: p, at: Date.now() };
      var keys = Object.keys(m).sort(); while (keys.length > 60) { delete m[keys.shift()]; }
      LS.set('saa.hwlog', m);
    }
  },
  get: function (date) { return HwLog.all()[date] || null; },
  recent: function (n) {
    var m = HwLog.all();
    return Object.keys(m).sort().slice(-(n || 7)).map(function (d) { return Object.assign({ date: d }, m[d]); });
  }
};
/* 🔊 読み上げ（Web Speech API・ゼロ依存）。ながら学習・耳復習用 */
var Speech = {
  ok: function () { return typeof window !== 'undefined' && 'speechSynthesis' in window; },
  on: function () { return LS.get('saa.tts', false); },
  setOn: function (v) { LS.set('saa.tts', !!v); if (!v) Speech.cancel(); },
  speak: function (text) {
    if (!Speech.ok() || !text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text).slice(0, 1200));
      u.lang = 'ja-JP'; u.rate = 1.05; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  },
  cancel: function () { if (Speech.ok()) { try { window.speechSynthesis.cancel(); } catch (e) {} } }
};
/* 問題（＋選択肢）を読み上げ用テキストに */
function ttsQuestionText(q) {
  var L = [String(q.text || '').replace(/\s+/g, ' ')];
  (q.choices || []).forEach(function (c, i) { L.push((FLASH_LETTERS[i] || (i + 1)) + '、' + c); });
  return L.join('。 ');
}
function ttsAnswerText(q) {
  var cor = (q.correct || []).map(function (n) { return FLASH_LETTERS[n - 1] || n; }).join('、');
  var t = '正解は、' + cor + '。';
  if (q.correctTheme) t += ' ポイント、' + q.correctTheme + '。';
  return t;
}

/* 直近の宿題達成率の履歴カード（％の推移を棒で表示） */
function hwHistoryCard() {
  var rec = HwLog.recent(7);
  if (!rec.length) return '';
  var avg = Math.round(rec.reduce(function (a, b) { return a + (b.pct || 0); }, 0) / rec.length);
  var bars = rec.map(function (r) {
    var col = r.pct >= 100 ? 'var(--ok)' : r.pct >= 50 ? 'var(--warn)' : 'var(--bad)';
    return '<div class="hwh-col"><div class="hwh-bar"><i style="height:' + Math.max(4, r.pct) + '%;background:' + col + '"></i></div>' +
      '<div class="hwh-pct">' + r.pct + '%</div>' +
      '<div class="hwh-d">' + esc(jpDateLabel(r.date).replace(/\(.\)/, '')) + '</div></div>';
  }).join('');
  return '<div class="card"><div class="row"><b class="grow">📈 宿題の達成率（直近' + rec.length + '日）</b>' +
    '<span class="small muted">平均 ' + avg + '%</span></div>' +
    '<div class="hwh-wrap">' + bars + '</div></div>';
}
function startHomeworkSession(hw, subset) {
  state.lastHw = hw;
  var src = (subset && subset.length) ? subset : (hw.items || []);
  var qs = [];
  src.forEach(function (it) {
    var d = Store.getDeck(it.deckId); if (!d) return;
    var q = (d.questions || []).find(function (x) { return x.num === it.num; });
    if (q) { var qq = Object.assign({}, q); qq._deck = it.deckId; qq._why = it.why; qs.push(qq); }
  });
  if (!qs.length) { toast('対象の問題が見つかりません'); return; }
  state.exam = { deckId: src[0].deckId, deckName: '今日の宿題', qs: qs, idx: 0, answers: {}, flags: {}, startedAt: Date.now(), study: true, revealed: {}, hw: true };
  saveActiveExam(); show('examRun');
}
function finishHomework() {
  var ex = state.exam; if (_timer) clearInterval(_timer);
  ex.graded = ex.graded || {};
  var ok = 0;
  ex.qs.forEach(function (q) {
    var sel = (ex.answers[q.num] || []).slice();
    var correct = sel.length > 0 && eqSet(sel, q.correct);
    if (correct) ok++;
    if (!ex.graded[q.num]) { SRS.grade(q._deck || ex.deckId, q.num, correct); ex.graded[q.num] = true; }  // 答え合わせ済みは二重採点しない
  });
  HwStreak.bump();
  state.lastHwResult = { total: ex.qs.length, correct: ok };
  state.exam = null; clearActiveExam();
  toast(ok + ' / ' + ex.qs.length + ' 正解・宿題を更新');
  show('homework');
}
/* 今日の宿題：TODOチェックリスト */
/* 見直し対象（誤答=srcVerdict×）プールを cache から作る（scope: 特定デッキ or 全デッキ） */
function reviewPool(scopeId) {
  var ids = scopeId ? [scopeId] : Store.deckIds();
  var today = ymdLocal(new Date());
  var pool = [];
  ids.forEach(function (id) {
    var d = Store.getDeck(id); if (!d) return;
    (d.questions || []).forEach(function (q) {
      if (q.srcVerdict !== '×' || !q.srcAnswer) return;
      var s = SRS.get(id, q.num) || {}, c = (CONF.get(id, q.num) || {}).c || '';
      var omoi = (c === '◎' || c === '○');
      pool.push({ deckId: id, num: q.num, genre: q.genre || '',
        why: omoi ? ('思い込み（自信' + c + 'で誤答）') : '不正解の復習',
        box: s.box || 0, reviewed: !!(s.box || s.last), mastered: (s.box || 0) >= 3,
        omoi: omoi, doneToday: (s.lastDay === today) });
    });
  });
  return pool;
}
function reviewStats(scopeId) {
  var p = reviewPool(scopeId), reviewed = 0, mastered = 0, omoiRemain = 0;
  p.forEach(function (x) { if (x.reviewed) reviewed++; if (x.mastered) mastered++; if (x.omoi && !x.mastered) omoiRemain++; });
  return { total: p.length, reviewed: reviewed, untouched: p.length - reviewed, mastered: mastered, omoiRemain: omoiRemain };
}
/* 見直しの全体像カード（今日の分だけでなく、誤答全体の残量を表示） */
function reviewCardHtml(scopeId) {
  var st = reviewStats(scopeId);
  if (!st.total) return '';
  var label = scopeId ? ActiveDeck.label() : '全デッキ';
  var remain = st.total - st.mastered;
  var n = HW_N;
  return '<div class="card active-deck-card"><h3 style="margin:.1em 0 .4em">📚 誤答の見直し（' + esc(label) + '）</h3>' +
    '<div class="bar"><i style="width:' + pct(st.mastered, st.total) + '%"></i></div>' +
    '<div class="small" style="margin-top:6px">誤答 <b>' + st.total + '</b>問 ｜ 着手 ' + st.reviewed + ' ｜ 克服 ' + st.mastered + ' ｜ <span class="ngc">🔴思い込み残 ' + st.omoiRemain + '</span></div>' +
    '<div class="small muted" style="margin-top:2px">未着手 ' + st.untouched + ' ／ 残り(未克服) <b>' + remain + '</b>問（1日' + n + '問で約' + Math.max(1, Math.ceil(remain / n)) + '日）</div>' +
    (remain > 0
      ? '<button class="btn primary block" data-act="hwReview" style="margin-top:10px">▶ 誤答の見直しを続ける（残りから' + Math.min(remain, 20) + '問）</button>'
      : '<div class="small okc" style="margin-top:6px">🎉 誤答はすべて克服！</div>') +
    '</div>';
}
/* 見直しセッション（残りの誤答を思い込み優先でまとめて） */
function startReviewSession(items) {
  var qs = [];
  items.forEach(function (it) {
    var d = Store.getDeck(it.deckId); if (!d) return;
    var q = (d.questions || []).find(function (x) { return x.num === it.num; });
    if (q) { var qq = Object.assign({}, q); qq._deck = it.deckId; qq._why = it.why; qs.push(qq); }
  });
  if (!qs.length) { toast('対象の問題が見つかりません'); return; }
  state.exam = { deckId: items[0].deckId, deckName: '誤答の見直し', qs: qs, idx: 0, answers: {}, flags: {}, startedAt: Date.now(), study: true, revealed: {}, hw: true };
  saveActiveExam(); show('examRun');
}
/* ⚡ サクッと集中：最重要(思い込み優先)からN問だけ。1問ずつ即採点＋即解説の短時間セッション */
function startQuickFocus(n) {
  var pool = reviewPool(ActiveDeck.deckId());
  var avail = pool.filter(function (x) { return !x.mastered && !x.doneToday; });
  if (!avail.length) avail = pool.filter(function (x) { return !x.doneToday; });   // 今日分が尽きたら克服済みも復習に回す
  if (!avail.length) avail = pool.slice();                                          // それも無ければ全プールから
  if (!avail.length) { toast('対象の問題がありません。まず誤答（模試結果）を取込んでください'); return; }
  avail.sort(function (a, b) { return (a.omoi ? 0 : 1) - (b.omoi ? 0 : 1) || a.box - b.box; });  // 思い込み→box小（=苦手）優先
  var items = avail.slice(0, n);
  var qs = [];
  items.forEach(function (it) {
    var d = Store.getDeck(it.deckId); if (!d) return;
    var q = (d.questions || []).find(function (x) { return x.num === it.num; });
    if (q) { var qq = Object.assign({}, q); qq._deck = it.deckId; qq._why = it.why; qs.push(qq); }
  });
  if (!qs.length) { toast('対象の問題が見つかりません'); return; }
  state.exam = { deckId: items[0].deckId, deckName: '⚡ 最重要' + qs.length + '問', qs: qs, idx: 0, answers: {}, flags: {}, startedAt: Date.now(), study: true, revealed: {}, hw: true };
  saveActiveExam(); show('examRun');
}
/* ---------- 🎮 ながら復習（めくるだけフラッシュカード） ---------- */
/* ゲームの合間など隙間時間用。選択不要・タップ/スワイプでめくる・採点ノルマなし。
   ✓/△だけ押せばSRS（弱点・宿題・スケジュール実績）に反映される。 */
var FLASH_LETTERS = 'アイウエオカキクケコ';
function buildFlashQueue() {
  var pool = reviewPool(ActiveDeck.deckId());
  function srt(arr) { arr.sort(function (a, b) { return (a.omoi ? 0 : 1) - (b.omoi ? 0 : 1) || a.box - b.box; }); }
  var todo = pool.filter(function (x) { return !x.doneToday; });   // 今日まだ見ていないものを先に
  var rest = pool.filter(function (x) { return x.doneToday; });
  srt(todo); srt(rest);
  return todo.concat(rest);
}
function startFlash() {
  var q = buildFlashQueue();
  if (!q.length) { toast('対象がありません。誤答（模試結果）を取込むと使えます'); return; }
  state.flash = { items: q, idx: 0, revealed: false, seen: 0 };
  show('flash');
}
function flashCur() {
  var fl = state.flash; if (!fl || fl.idx >= fl.items.length) return null;
  var it = fl.items[fl.idx];
  var d = Store.getDeck(it.deckId); if (!d) return null;
  var q = (d.questions || []).find(function (x) { return x.num === it.num; });
  return q ? { it: it, q: q, deckName: d.name } : null;
}
function flashReveal() { var fl = state.flash; if (!fl || fl.revealed) return; fl.revealed = true; fl.seen++; renderFlash(); }
function flashAdvance(correct) {
  var fl = state.flash; if (!fl) return;
  var c = flashCur();
  if (c && correct != null) { SRS.grade(c.it.deckId, c.it.num, correct); HwStreak.bump(); }   // ✓/△でSRS反映
  fl.idx++; fl.revealed = false; renderFlash();
}
function renderFlash() {
  var fl = state.flash; if (!fl) return show('home');
  // 末尾まで来たら完了画面
  while (fl.idx < fl.items.length && !flashCur()) fl.idx++;
  if (fl.idx >= fl.items.length) {
    app.innerHTML = '<div class="card" style="text-align:center;margin-top:20px">' +
      '<div class="bigpct">🎉</div><h3 style="margin:.2em 0">ひとめぐり完了！</h3>' +
      '<div class="muted small">めくった ' + fl.seen + ' 枚 ・ お疲れさま</div>' +
      '<div class="btnrow" style="margin-top:14px;justify-content:center">' +
      '<button class="btn primary grow" data-act="flashRestart">🔁 もう一周</button>' +
      '<button class="btn grow" data-act="home">🏠 ホーム</button></div></div>';
    return;
  }
  var c = flashCur(), q = c.q, it = c.it;
  var idl = qId(c.deckName || it.deckId, q.num);
  var chs = (q.choices || []).map(function (ch, i) {
    return '<div class="flash-ch"><span class="let">' + (FLASH_LETTERS[i] || (i + 1)) + '</span><span>' + esc(ch) + '</span></div>';
  }).join('');
  var ttsBtn = Speech.ok()
    ? '<button class="btn ' + (Speech.on() ? 'primary' : 'ghost') + ' sm" data-act="flashTts" title="自動読み上げ">🔊' + (Speech.on() ? ' ON' : '') + '</button>'
    : '';
  var head =
    '<div class="row" style="align-items:center">' +
    '<b class="grow">🎮 ながら復習</b>' +
    '<span class="small muted">めくった ' + fl.seen + ' 枚</span>' +
    ttsBtn +
    '<button class="btn ghost sm" data-act="home" style="margin-left:6px">終了</button></div>';
  var pills =
    '<div class="row wrap" style="gap:6px;margin:8px 0 4px">' +
    '<span class="pill id">🆔 ' + esc(idl) + '</span>' +
    '<span class="pill g">' + esc(q.genre || '') + '</span>' +
    (it.omoi ? '<span class="pill hi">🔴 思い込み</span>' : '') + '</div>';
  var body;
  if (!fl.revealed) {
    body =
      '<div class="card flash-card" data-act="flashReveal">' + pills +
      '<div class="qtext">' + esc(q.text) + '</div>' +
      '<div class="flash-choices">' + chs + '</div>' +
      '<div class="flash-hint">タップ／スワイプで答えを見る 👀</div></div>' +
      '<div class="sticky-bottom">' +
      (Speech.ok() ? '<button class="btn" data-act="flashSpeak">🔊 読む</button>' : '') +
      '<button class="btn primary grow" data-act="flashReveal">👀 答えを見る</button></div>';
  } else {
    var cor = (q.correct || []).map(function (n) { return FLASH_LETTERS[n - 1] || n; }).join('');
    var theme = (q.correctTheme || '').trim();
    var expl = effExpl(it.deckId, q);
    body =
      '<div class="card flash-card revealed">' + pills +
      '<div class="qtext small">' + esc(q.text) + '</div>' +
      '<div class="flash-answer">正解 <b>' + esc(cor) + '</b>' + (theme ? '　<span class="small">' + esc(theme) + '</span>' : '') + '</div>' +
      (expl ? '<details class="moredetail"><summary>📄 解説を見る</summary><div class="expl">' + mdToHtml(expl) + '</div></details>' : '') +
      '</div>' +
      '<div class="sticky-bottom">' +
      '<button class="btn grow okbtn" data-act="flashGood">✓ わかった</button>' +
      '<button class="btn grow ngbtn" data-act="flashBad">△ あやしい</button>' +
      '<button class="btn ghost" data-act="flashNext">次へ ＞</button></div>';
  }
  app.innerHTML = head + body;
  decorateGlossary();
  if (Speech.on()) Speech.speak(fl.revealed ? ttsAnswerText(q) : ttsQuestionText(q));   // 自動読み上げ
}
function renderHomework() {
  var today = ymdLocal(new Date()), hw = state.lastHw;
  var html = reviewCardHtml(ActiveDeck.deckId());   // 見直しの全体像（常に先頭に表示）
  if (hw && hw.date === today && (hw.items || []).length) {
    var items = hw.items;
    var doneF = items.map(function (it) { var s = SRS.get(it.deckId, it.num); return !!(s && s.lastDay === today); });
    var done = doneF.filter(Boolean).length, total = items.length, remain = total - done;
    var prog = pct(done, total);
    HwLog.record(done, total);   // 当日の進捗率を記録（端末内・履歴用）
    var streak = HwStreak.get().n;
    var rows = '';
    items.forEach(function (it, i) {
      var dn = doneF[i];
      var idl = qId(it.deckName || it.deckId, it.num);
      rows += '<button class="btn block hw-item' + (dn ? ' done' : '') + '" data-act="hwItem" data-i="' + i + '">' +
        '<span class="hw-mk">' + (dn ? '✅' : '☐') + '</span>' +
        '<span class="grow hw-body"><b>' + esc(idl) + '</b> <span class="small muted">' + esc(it.genre || '') + '</span><br>' +
        '<span class="small">' + esc(it.why || '') + '</span></span>' +
        '<span class="small">' + (dn ? '済' : '解く →') + '</span></button>';
    });
    html +=
      '<div class="card"><div class="row"><h3 class="grow" style="margin:0">📅 今日の宿題</h3>' +
      '<button class="btn ghost sm" data-act="startHw">↻ 再取得</button></div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(hw.date) + ' ・ 本番まで' + (hw.daysLeft != null ? hw.daysLeft : '-') + '日 ・ 🔥連続' + streak + '日</div>' +
      '<div class="hw-total" style="margin-top:8px"><span class="hw-total-num">全 ' + total + ' 問</span>' +
      '<span class="hw-pct">進捗 ' + prog + '%</span>' +
      '<span class="small">　完了 ' + done + ' ／ 残り <b>' + remain + '</b> 問</span></div>' +
      '<div class="bar" style="margin-top:8px"><i style="width:' + prog + '%"></i></div>' +
      (remain === 0 ? '<div class="small okc" style="margin-top:6px">🎉 今日の宿題は全部できた！（達成率100%）</div>' : '') +
      '<div class="btnrow" style="margin-top:10px">' +
      (remain > 0 ? '<button class="btn primary grow" data-act="hwAll">▶ 残り' + remain + '問をまとめて解く</button>' : '') +
      '<button class="btn grow" data-act="hwPrint">🖨 宿題をプリント（全' + total + '問）</button>' +
      '</div>' +
      '</div>' +
      '<div class="card">' + rows + '</div>' +
      hwHistoryCard() +
      '<div class="card"><p class="small muted">AI家庭教師で深掘りするには下をコピー。</p>' +
      '<button class="btn block" data-act="hwTutorCopy">📋 今日の宿題を教師プロンプトでやる（コピー）</button></div>';
  } else {
    html += '<div class="card"><h3>📅 今日の宿題</h3>' +
      '<p class="small muted">サーバーから今日の分（約' + HW_N + '問）を取得します。</p>' +
      '<button class="btn primary block" data-act="startHw">今日の宿題を取得</button></div>';
  }
  app.innerHTML = html;
}
function renderHwResult() {
  var r = state.lastHwResult || { total: 0, correct: 0 }, hw = state.lastHw || {};
  var rpct = pct(r.correct, r.total);
  var todayLog = HwLog.get(ymdLocal(new Date()));
  app.innerHTML = '<div class="card" style="text-align:center"><div class="small muted">今日の宿題 ' + esc(hw.date || '') + '</div>' +
    '<div class="bigpct">' + rpct + '%</div>' +
    '<div class="muted">正解 ' + r.correct + ' / ' + r.total + '問' + (todayLog ? ' ・ 本日の進捗 ' + todayLog.pct + '%' : '') + '</div>' +
    '<div class="muted">本番まで ' + (hw.daysLeft != null ? hw.daysLeft : '-') + '日</div></div>' +
    '<div class="card"><p class="small muted">この宿題をAI家庭教師でさらに深掘りできます。下をコピーして、Claudeの対話学習プロンプトに続けて貼ってください。</p>' +
    '<button class="btn primary block" data-act="hwTutorCopy">📋 今日の宿題を教師プロンプトでやる（コピー）</button></div>' +
    '<div class="btnrow"><button class="btn grow" data-act="startHw">🔁 もう一度</button>' +
    '<button class="btn grow" data-act="home">🏠 ホーム</button></div>';
}
function buildTodayTutorPrompt(hw) {
  var L = ['【SAA-C03 今日の宿題】' + (hw.date || '') + '（本番まで' + (hw.daysLeft != null ? hw.daysLeft : '?') + '日）', '',
    '私はこの問題セットを今日解きました。1問ずつ、私の回答を待ってから採点し、なぜ正解で他がダメかを本番レベルで解説してください。◎○で外した「思い込み」は特に重点的に。', '',
    '対象（実際の模試の問題番号）:'];
  (hw.items || []).forEach(function (it) { L.push('- ' + (it.deckName || it.deckId) + ' Q' + it.num + '（' + (it.genre || '') + '／' + (it.why || '') + '）'); });
  L.push('', 'まず1問目から、模試と同じ難易度で出題してください。');
  return L.join('\n');
}
/* 試験ランナーで「今日の宿題」は複数デッキ横断。問題ごとの所属デッキを返す */
function qDeckId(q) { var ex = state.exam; return (ex && ex.hw && q && q._deck) ? q._deck : (ex ? ex.deckId : ''); }

/* ---------- 今日の宿題をプリント（白黒印刷向けの別ページを生成） ---------- */
var PRINT_LETTERS = 'アイウエオカキクケコ';
function buildHomeworkPrintHtml(hw) {
  var items = (hw && hw.items) || [];
  // hwの各項目から実際の問題データを引く
  var qs = [];
  items.forEach(function (it) {
    var d = Store.getDeck(it.deckId); if (!d) return;
    var q = (d.questions || []).find(function (x) { return x.num === it.num; });
    if (q) qs.push({ q: q, id: qId(d.name || it.deckId, it.num), deckId: it.deckId, deckName: d.name || it.deckId, genre: q.genre || it.genre || '' });
  });
  var date = hw.date || ymdLocal(new Date());
  var daysLeft = (hw.daysLeft != null) ? hw.daysLeft : daysUntilLocalDate(SCHEDULE_EXAM_DATE);
  var css = '@page{size:A4;margin:13mm 12mm}*{box-sizing:border-box}' +
    'body{font-family:"Yu Gothic","Meiryo",sans-serif;color:#000;font-size:10.5pt;line-height:1.5}' +
    'h1{font-size:16pt;margin:0 0 2px}' +
    '.meta{font-size:9.5pt;margin-bottom:9px;border-bottom:2px solid #000;padding-bottom:5px}' +
    '.section-title{font-size:13pt;font-weight:bold;border-left:5px solid #000;padding-left:8px;margin:0 0 9px}' +
    '.q{border:1px solid #000;border-radius:4px;padding:7px 9px;margin-bottom:8px;page-break-inside:avoid}' +
    '.qhead{display:flex;align-items:center;gap:7px;margin-bottom:4px;flex-wrap:wrap}' +
    '.qid{font-weight:bold;border:1.5px solid #000;padding:0 8px;border-radius:3px;font-size:10pt}' +
    '.gtag{font-size:8.5pt;border:1px solid #000;padding:0 6px;border-radius:3px}' +
    '.ans-blank{margin-left:auto;font-size:9.5pt;font-weight:bold}.qtext{margin-bottom:5px;white-space:pre-wrap}' +
    '.ch{display:flex;gap:6px;padding:1.5px 0;align-items:flex-start}.let{font-weight:bold;min-width:1.4em}' +
    '.pagebreak{page-break-before:always}' +
    '.a{border-bottom:1px solid #000;padding:7px 0;page-break-inside:avoid}' +
    '.ahead{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}' +
    '.cor{font-weight:bold;font-size:11pt;text-decoration:underline}' +
    '.rsn{font-size:9.5pt;line-height:1.55}.rsn .md-h{font-size:10pt;font-weight:bold;margin:5px 0 2px}.rsn ul{margin:2px 0 2px 0;padding-left:1.2em}.rsn li{margin:1px 0}.rsn p{margin:2px 0}' +
    '@media screen{body{max-width:820px;margin:20px auto;padding:0 16px}}' +
    '.tip{border:1px solid #000;border-radius:4px;padding:8px 12px;font-size:9.5pt;margin-bottom:12px}';
  var H = [];
  H.push('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>今日の宿題 ' + date + '</title><style>' + css + '</style></head><body>');
  H.push('<div class="tip">📄 このページで <b>Ctrl+P</b>（スマホは共有→印刷）で用紙/PDF出力。問題のあと改ページして<b>解答・解説</b>が続きます。各問の <b>ID（例 模試4-Q21）</b>で結果を写真に撮って送ってください。</div>');
  H.push('<h1>今日の宿題</h1>');
  H.push('<div class="meta">' + date + '　／　本番まで残り' + daysLeft + '日　／　全' + qs.length + '問　／　ID付き</div>');
  // 問題セクション
  H.push('<div class="section-title">■ 問題（全' + qs.length + '問）</div>');
  qs.forEach(function (o) {
    var q = o.q;
    var chs = (q.choices || []).map(function (c, i) {
      return '<div class="ch"><span class="let">' + (PRINT_LETTERS[i] || (i + 1)) + '</span><span>' + esc(c) + '</span></div>';
    }).join('');
    H.push('<div class="q"><div class="qhead"><span class="qid">' + esc(o.id) + '</span>' +
      '<span class="gtag">' + esc(o.genre) + '</span>' +
      '<span class="ans-blank">解答[　　]</span></div>' +
      '<div class="qtext">' + esc(q.text) + '</div><div class="choices">' + chs + '</div></div>');
  });
  // 解答・解説セクション
  H.push('<div class="pagebreak"></div><div class="section-title">■ 解答・解説</div>');
  qs.forEach(function (o) {
    var q = o.q;
    var cor = (q.correct || []).map(function (n) { return PRINT_LETTERS[n - 1] || n; }).join('');
    var expl = effExpl(o.deckId, q);
    var body = expl ? mdToHtml(expl) : (q.explanation ? '<p>' + esc(q.explanation) + '</p>' : '<p>(解説データなし)</p>');
    H.push('<div class="a"><div class="ahead"><span class="qid">' + esc(o.id) + '</span>' +
      '<span class="cor">正解 ' + esc(cor) + '</span><span class="gtag">' + esc(o.genre) + '</span></div>' +
      '<div class="rsn">' + body + '</div></div>');
  });
  H.push('</body></html>');
  return H.join('');
}
function printHomework() {
  var hw = state.lastHw;
  if (!hw || !(hw.items || []).length) { toast('先に今日の宿題を取得してください'); return; }
  var html = buildHomeworkPrintHtml(hw);
  var w = window.open('', '_blank');
  if (!w) { toast('ポップアップがブロックされました。許可してください'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  // 描画後に印刷ダイアログを開く（スマホ含め手動Ctrl+Pでも可）
  setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

/* 表示に使う解説（自分で追記したもの＞取込んだGemini解説） */
function effExpl(deckId, q) { return ExplStore.get(deckId, q.num) || q.gemini || ''; }

/* ---------- Gemini API（任意・キーは端末内保存） ---------- */
function geminiKey() { return LS.get('saa.gkey', ''); }
function geminiModel() { return LS.get('saa.gmodel', 'gemini-2.5-flash'); }
function ensureGeminiKey() {
  var k = geminiKey();
  if (k) return k;
  k = prompt('Gemini APIキーを入力してください（このブラウザにのみ保存）\n無料取得: https://aistudio.google.com/apikey');
  if (k && k.trim()) { LS.set('saa.gkey', k.trim()); return k.trim(); }
  return '';
}
function buildGeminiPrompt(q) {
  var lines = [];
  lines.push('あなたはAWS認定ソリューションアーキテクト アソシエイト(SAA-C03)の講師です。');
  lines.push('次の問題について、日本語でわかりやすく詳しい解説をMarkdownで書いてください。');
  lines.push('構成：「1. 要点と正解の理由」「2. 各選択肢の解説（なぜ正解/不正解か）」「3. 押さえるべき重要ポイント」「4. 試験対策のひとこと」。表は使わず見出し(###)と箇条書きで。');
  lines.push('');
  lines.push('### 問題');
  lines.push(q.text);
  lines.push('### 選択肢');
  q.choices.forEach(function (c, i) { lines.push((i + 1) + '. ' + c); });
  lines.push('### 正解番号: ' + (q.correct.join(', ') || '不明'));
  if (q.explanation) { lines.push('### 公式解説（参考。これを噛み砕いて説明）'); lines.push(q.explanation); }
  return lines.join('\n');
}
function callGemini(promptText, key) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + geminiModel() + ':generateContent?key=' + encodeURIComponent(key);
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptText }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } })
  }).then(function (r) {
    if (!r.ok) return r.text().then(function (t) { throw new Error('API ' + r.status + ': ' + t.slice(0, 200)); });
    return r.json();
  }).then(function (data) {
    var cand = (data.candidates || [{}])[0];
    return ((cand.content || {}).parts || []).map(function (p) { return p.text || ''; }).join('').trim();
  });
}

/* ---------- 中断した試験の保存／再開 ---------- */
function saveActiveExam() {
  if (state.exam) LS.set('saa.activeExam', state.exam);
}
function clearActiveExam() { LS.del('saa.activeExam'); }
function loadActiveExam() {
  var ex = LS.get('saa.activeExam', null);
  if (ex && ex.qs && ex.qs.length && Store.getDeck(ex.deckId)) return ex;
  return null;
}

/* ---------- 直近の自分の回答（解説モードで色付け用） ---------- */
function lastAnswerMap(deckId) {
  var at = Store.attempts(deckId), m = {};
  at.forEach(function (a) { // 新しい回が後勝ち
    a.items.forEach(function (it) { m[it.num] = { selected: it.selected || [], isCorrect: it.isCorrect }; });
  });
  return m;
}

/* ---------- 全データのバックアップ／復元 ---------- */
function exportAllData() {
  var data = { _type: 'saa-moshi-backup', _version: 1, exportedAt: Date.now(), keys: {} };
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf('saa.') === 0) data.keys[k] = localStorage.getItem(k);
  }
  return JSON.stringify(data);
}
function importAllData(json) {
  var data = JSON.parse(json);
  if (!data || data._type !== 'saa-moshi-backup' || !data.keys) throw new Error('バックアップ形式ではありません');
  Object.keys(data.keys).forEach(function (k) { if (k.indexOf('saa.') === 0) localStorage.setItem(k, data.keys[k]); });
  return Object.keys(data.keys).length;
}

/* ---------- ジャンル(章)分類: 章別チェックリスト化.py を移植 ---------- */
var SVC2CH = [
 ['IAMロール','1-3'],['IAMポリシー','1-3'],['IAMユーザー','1-3'],['IAMグループ','1-3'],['IAM','1-3'],
 ['Cognito','1-3'],['Directory Service','1-3'],['Managed Microsoft AD','1-3'],['AD Connector','1-3'],
 ['Simple AD','1-3'],['IAM Identity Center','1-3'],['SSO','1-3'],['アクセスキー','1-3'],
 ['Access Analyzer','1-3'],['Session Manager','1-3'],
 ['SQS','1-7'],['SNS','1-7'],['SES','1-7'],['デッドレターキュー','1-7'],['DLQ','1-7'],
 ['可視性タイムアウト','1-7'],['Amazon MQ','1-7'],['Glue','1-7'],['EMR','1-7'],['Data Pipeline','1-7'],
 ['Step Functions','1-7'],['Kinesis','1-7'],['MSK','1-7'],['EventBridge','1-7'],['AppFlow','1-7'],
 ['Lake Formation','1-7'],['OpenSearch','1-7'],['AppSync','1-7'],['Comprehend','1-7'],['Forecast','1-7'],
 ['Kendra','1-7'],['Rekognition','1-7'],['SageMaker','1-7'],['Textract','1-7'],['Transcribe','1-7'],
 ['Translate','1-7'],['Polly','1-7'],
 ['VPCエンドポイント','1-2'],['VPCピアリング','1-2'],['Transit Gateway','1-2'],['PrivateLink','1-2'],
 ['NATゲートウェイ','1-2'],['NATインスタンス','1-2'],['インターネットゲートウェイ','1-2'],
 ['Direct Connect','1-2'],['Site-to-Site VPN','1-2'],['VPN','1-2'],['Route 53','1-2'],['Route53','1-2'],
 ['ALIAS','1-2'],['CloudFront','1-2'],['Global Accelerator','1-2'],['ロードバランサ','1-2'],
 ['ALB','1-2'],['NLB','1-2'],['ELB','1-2'],['サブネット','1-2'],['ルートテーブル','1-2'],['VPC','1-2'],
 ['Auto Scaling','1-4'],['スポットインスタンス','1-4'],['スポット','1-4'],['AWS Batch','1-4'],
 ['Fargate','1-4'],['ECS','1-4'],['EKS','1-4'],['Lambda','1-4'],['AMI','1-4'],
 ['プレイスメントグループ','1-4'],['EC2','1-4'],
 ['Glacier','1-5'],['Storage Gateway','1-5'],['EFS','1-5'],['FSx','1-5'],['EBS','1-5'],
 ['ライフサイクル','1-5'],['署名付きURL','1-5'],['S3','1-5'],
 ['Aurora','1-6'],['DynamoDB','1-6'],['DAX','1-6'],['ElastiCache','1-6'],['Redshift','1-6'],
 ['リードレプリカ','1-6'],['RDS','1-6'],['DocumentDB','1-6'],['Neptune','1-6'],['QLDB','1-6'],
 ['CloudFormation','1-8'],['Elastic Beanstalk','1-8'],['CodeCommit','1-8'],['CodeBuild','1-8'],
 ['CodeDeploy','1-8'],['CodePipeline','1-8'],['CDK','1-8'],
 ['CloudTrail','1-9'],['Config','1-9'],['Systems Manager','1-9'],['Trusted Advisor','1-9'],
 ['Organizations','1-9'],['Control Tower','1-9'],['CloudWatch','1-9'],
 ['KMS','2-4'],['Secrets Manager','2-4'],['ACM','2-4'],['証明書','2-4'],['暗号化','2-4'],
 ['WAF','2-3'],['Shield','2-3'],['ネットワークACL','2-3'],['NACL','2-3'],['エフェメラル','2-3'],
 ['セキュリティグループ','2-3'],
 ['GuardDuty','2-5'],['Macie','2-5'],['Inspector','2-5'],['Security Hub','2-5'],['Detective','2-5'],
 ['Elastic Disaster Recovery','3-1'],['フェイルオーバー','3-2'],['Multi-AZ','3-5'],['マルチAZ','3-2'],
 ['Cost Explorer','5-4'],['Budgets','5-4'],['Savings Plans','5-2'],['リザーブド','5-2']
];
var CH_NAME = {
 '1-2':'ネットワーク','1-3':'アクセス制御(IAM)','1-4':'コンピューティング','1-5':'ストレージ',
 '1-6':'データベース','1-7':'データ処理・分析(疎結合)','1-8':'構成管理・開発','1-9':'運用管理',
 '2-3':'ネットワークセキュリティ','2-4':'データの保護','2-5':'セキュリティ監視',
 '3-1':'高可用性の定義','3-2':'NW高可用','3-5':'DB高可用','5-2':'リソース選定','5-4':'コスト管理'
};
var IMP = {};
(function () {
  var A = ['VPC','サブネット','セキュリティグループ','NACL','ネットワークACL','NATゲートウェイ','Route 53','Route53','ALB','NLB','ELB','ロードバランサ','IAM','IAMロール','IAMポリシー','S3','Glacier','署名付きURL','EC2','Auto Scaling','スポットインスタンス','スポット','Lambda','RDS','Aurora','DynamoDB','リードレプリカ','Multi-AZ','マルチAZ','SQS','SNS','CloudFront','KMS','暗号化','フェイルオーバー'];
  var B = ['EventBridge','Step Functions','Kinesis','Direct Connect','Site-to-Site VPN','VPN','VPCエンドポイント','Transit Gateway','PrivateLink','VPCピアリング','Global Accelerator','ECS','Fargate','EKS','AMI','EBS','EFS','FSx','Storage Gateway','ライフサイクル','ElastiCache','DAX','Redshift','CloudFormation','CloudWatch','CloudTrail','Organizations','WAF','Shield','GuardDuty','Secrets Manager','ACM','証明書','Cognito','Directory Service','AWS Batch','デッドレターキュー','DLQ','可視性タイムアウト','エフェメラル','ALIAS','Savings Plans','リザーブド','Cost Explorer','Budgets','Elastic Disaster Recovery','Systems Manager','Config','Glue','EMR','Macie','Inspector','Security Hub'];
  A.forEach(function (k) { IMP[k] = 'A'; });
  B.forEach(function (k) { if (!IMP[k]) IMP[k] = 'B'; });
})();
var RANK = { A: 3, B: 2, C: 1 }, IMPNAME = { A: '高', B: '中', C: '低' };
function detect(text) {
  text = text || '';
  var chs = [], best = null;
  for (var i = 0; i < SVC2CH.length; i++) {
    var kw = SVC2CH[i][0], ch = SVC2CH[i][1];
    if (text.indexOf(kw) >= 0) {
      if (chs.indexOf(ch) < 0) chs.push(ch);
      var r = IMP[kw] || 'C';
      if (best === null || RANK[r] > RANK[best]) best = r;
    }
  }
  return { chs: chs.slice(0, 3), imp: best || 'B' };
}
function classify(q) {
  var correctText = (q.correct && q.correct[0]) ? (q.choices[q.correct[0] - 1] || '') : '';
  var d = detect(correctText);
  if (!d.chs.length) d = detect(q.text);
  var code = d.chs[0] || '?';
  return {
    code: code,
    name: code === '?' ? '未分類' : (code + ' ' + (CH_NAME[code] || '')).trim(),
    imp: IMPNAME[d.imp] || '中'
  };
}

/* ---------- CSV パーサ(引用符・改行対応) ---------- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  var rows = [], row = [], field = '', inQ = false, i = 0, c;
  while (i < text.length) {
    c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++; continue;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function detectCsvType(rows) {
  var h = (rows[0] || []).map(function (x) { return x.trim(); });
  if (h.indexOf('問題内容') >= 0) return 'questions';
  if (h.indexOf('主担当章') >= 0) return 'checklist';
  return 'unknown';
}
function deckNameFromFile(fname) {
  var n = fname.replace(/\.(csv|md|json)$/i, '')
    .replace(/_問題集.*$/, '').replace(/_章別チェックリスト.*$/, '')
    .replace(/_Gemini解説.*$/i, '').replace(/_学習データ.*$/, '')
    .replace(/_チェック済$/, '').trim();
  // 丸数字→算用数字に統一（模試② と 模試2 を同じデッキ扱い）
  var circ = '①②③④⑤⑥⑦⑧⑨';
  n = n.replace(/[①-⑨]/g, function (c) { return String(circ.indexOf(c) + 1); });
  return n || 'デッキ';
}
/* デッキ名の表示用ラベル（算用数字→丸数字に統一：模試3→模試③） */
function deckLabel(name) {
  var c = '①②③④⑤⑥⑦⑧⑨';
  return String(name == null ? '' : name)
    .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); }) // 全角→半角
    .replace(/[1-9]/g, function (d) { return c[+d - 1]; });
}
/* 問題ID（プリント・写真照合・AI管理用）。デッキ名/IDの丸数字・全角を半角化し「模試4-Q21」形式に */
function deckCode(nameOrId) {
  var circ = '①②③④⑤⑥⑦⑧⑨';
  return String(nameOrId == null ? '' : nameOrId)
    .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); })
    .replace(/[①-⑨]/g, function (c) { return String(circ.indexOf(c) + 1); })
    .replace(/\s+/g, '').trim();
}
function qId(deckNameOrId, num) { return deckCode(deckNameOrId) + '-Q' + num; }
/* デッキIDから表示名を引いてID化（見つからなければIDをそのまま使う） */
function qIdByDeck(deckId, num, fallbackName) {
  var d = Store.getDeck(deckId);
  return qId((d && d.name) || fallbackName || deckId, num);
}
/* 試験ランナー中の問題のID（宿題は問題ごとに所属デッキが異なる） */
function qIdForExam(ex, q) {
  var did = (ex && ex.hw && q && q._deck) ? q._deck : (ex ? ex.deckId : '');
  return qIdByDeck(did, q.num, ex && ex.deckName);
}
/* Gemini解説JSON（{ "1":"md", "2":"md", ... }）を {番号: 本文} に */
function parseGeminiJson(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var obj = JSON.parse(text), map = {};
  Object.keys(obj).forEach(function (k) {
    var num = parseInt(k, 10);
    if (!isNaN(num) && typeof obj[k] === 'string' && obj[k].trim()) map[num] = obj[k];
  });
  return map;
}
/* Gemini解説md（## 問題 N 見出し区切り）を {番号: 本文} に */
function parseGeminiMd(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var lines = text.split(/\r?\n/);
  var map = {}, cur = null, buf = [];
  var re = /^##\s*問題\s*(\d+)/;
  function flush() {
    if (cur != null) {
      var body = buf.join('\n').trim().replace(/^\*正解テーマ:[^\n]*\*\s*/, '').trim();
      if (body) map[cur] = body;
    }
    buf = [];
  }
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(re);
    if (m) { flush(); cur = parseInt(m[1], 10); continue; }
    if (cur != null) buf.push(lines[i]);
  }
  flush();
  return map;
}
function applyGemini(deck, map) {
  var n = 0;
  deck.questions.forEach(function (q) { if (map[q.num]) { q.gemini = map[q.num]; n++; } });
  deck.hasGemini = (deck.questions.filter(function (q) { return q.gemini; }).length > 0);
  return n;
}
/* ごく簡易なMarkdown→HTML（見出し/太字/箇条書き/区切り/コード） */
function mdToHtml(md) {
  var lines = String(md || '').split(/\r?\n/), out = [], inList = false;
  function closeList() { if (inList) { out.push('</ul>'); inList = false; } }
  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`]+)`/g, '<code class="k">$1</code>');
    return s;
  }
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (t === '') { closeList(); continue; }
    if (/^-{3,}$/.test(t) || /^\*{3,}$/.test(t)) { closeList(); out.push('<hr class="sep">'); continue; }
    var hm = t.match(/^(#{1,4})\s+(.*)$/);
    if (hm) { closeList(); var lv = Math.min(hm[1].length + 2, 6); out.push('<h' + lv + ' class="md-h">' + inline(hm[2]) + '</h' + lv + '>'); continue; }
    var lm = t.match(/^(?:[*\-]|\d+\.)\s+(.*)$/);
    if (lm) { if (!inList) { out.push('<ul class="md-ul">'); inList = true; } out.push('<li>' + inline(lm[1]) + '</li>'); continue; }
    closeList(); out.push('<p class="md-p">' + inline(t) + '</p>');
  }
  closeList();
  return out.join('');
}
function buildQuestions(rows) {
  var h = rows[0].map(function (x) { return x.trim(); });
  function idx(n) { return h.indexOf(n); }
  var cNum = idx('問題番号'), cText = idx('問題内容'), cCor = idx('正解番号'), cExp = idx('解説');
  var cVer = idx('正誤'), cAns = idx('回答番号'); // 本番(模試)の正誤・自分の回答（自信度トリアージ用）
  var choiceCols = [];
  for (var k = 1; k <= 8; k++) { var j = idx('選択肢' + k); if (j >= 0) choiceCols.push(j); }
  var out = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row || (row.length === 1 && row[0].trim() === '')) continue;
    var num = parseInt((row[cNum] || '').trim(), 10);
    if (isNaN(num)) continue;
    var choices = choiceCols.map(function (cc) { return (row[cc] || '').trim(); })
      .filter(function (x) { return x !== ''; });
    var correct = (row[cCor] || '').split(';').map(function (s) { return parseInt(s.trim(), 10); })
      .filter(function (n) { return !isNaN(n); });
    var q = { num: num, text: (row[cText] || '').trim(), choices: choices, correct: correct, explanation: (row[cExp] || '').trim() };
    var g = classify(q);
    q.genreCode = g.code; q.genre = g.name; q.importance = g.imp;
    q.correctTheme = (q.correct[0] ? (q.choices[q.correct[0] - 1] || '') : '').slice(0, 40);
    if (cAns >= 0) {
      var sa = (row[cAns] || '').split(';').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n); });
      if (sa.length) q.srcAnswer = sa;
    }
    if (cVer >= 0 && (row[cVer] || '').trim()) {
      var sv = (row[cVer] || '').trim();
      if (sv === '○' || q.srcAnswer) q.srcVerdict = sv; // 未回答CSVの×は誤答扱いしない
    }
    out.push(q);
  }
  out.sort(function (a, b) { return a.num - b.num; });
  return out;
}
function applyChecklist(deck, rows) {
  var h = rows[0].map(function (x) { return x.trim(); });
  function idx(n) { return h.indexOf(n); }
  var cNum = idx('問題番号'), cMain = idx('主担当章'), cName = idx('章名'), cImp = idx('重要度');
  var map = {};
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r]; if (!row || !row[cNum]) continue;
    var num = parseInt((row[cNum] || '').trim(), 10); if (isNaN(num)) continue;
    map[num] = {
      code: (row[cMain] || '').trim(),
      name: (row[cName] || '').split(';')[0].trim(),
      imp: (row[cImp] || '').trim()
    };
  }
  deck.questions.forEach(function (q) {
    var m = map[q.num];
    if (m && m.code && m.code !== '?') {
      q.genreCode = m.code;
      q.genre = (m.code + ' ' + (m.name || CH_NAME[m.code] || '')).trim();
      if (m.imp) q.importance = m.imp;
    }
  });
  deck.hasChecklist = true;
}

/* ---------- 集計 ---------- */
/* 練習モードの問題別成績（試験とは別管理。苦手判定には合算する） */
var PStats = {
  all: function (deckId) { return LS.get('saa.pstats.' + deckId, {}); },
  count: function (deckId) { return Object.keys(PStats.all(deckId)).length; },
  record: function (deckId, num, ok) {
    var m = PStats.all(deckId), s = m[num] || (m[num] = { seen: 0, correct: 0 });
    s.seen++; if (ok) s.correct++;
    LS.set('saa.pstats.' + deckId, m);
  }
};
function qStats(deckId) {
  var at = Store.attempts(deckId), m = {};
  at.forEach(function (a) {
    a.items.forEach(function (it) {
      var s = m[it.num] || (m[it.num] = { seen: 0, correct: 0, last: null });
      s.seen++; if (it.isCorrect) s.correct++; s.last = it.isCorrect;
    });
  });
  var p = PStats.all(deckId);
  Object.keys(p).forEach(function (num) {
    var s = m[num] || (m[num] = { seen: 0, correct: 0, last: null });
    s.seen += p[num].seen; s.correct += p[num].correct;
  });
  return m;
}
function genreStats(deckId) {
  var at = Store.attempts(deckId), m = {};
  at.forEach(function (a) {
    a.items.forEach(function (it) {
      var k = it.genreCode || '?';
      var s = m[k] || (m[k] = { code: k, name: it.genre || k, seen: 0, correct: 0 });
      s.seen++; if (it.isCorrect) s.correct++;
    });
  });
  var deck = Store.getDeck(deckId), p = PStats.all(deckId);
  if (deck) {
    var byNum = {}; deck.questions.forEach(function (q) { byNum[q.num] = q; });
    Object.keys(p).forEach(function (num) {
      var q = byNum[num]; if (!q) return;
      var k = q.genreCode || '?';
      var s = m[k] || (m[k] = { code: k, name: q.genre || k, seen: 0, correct: 0 });
      s.seen += p[num].seen; s.correct += p[num].correct;
    });
  }
  return m;
}
function deckGenres(deck) {
  var m = {};
  deck.questions.forEach(function (q) {
    var k = q.genreCode || '?';
    var s = m[k] || (m[k] = { code: k, name: q.genre || k, count: 0 });
    s.count++;
  });
  return Object.keys(m).map(function (k) { return m[k]; })
    .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
}

/* ============================ 共有ビュー部品 ============================ */
/* 選択肢を「正解=緑／自分の誤答=赤」で表示（解説・結果で共用） */
function choicesView(q, selected) {
  selected = selected || [];
  var h = '';
  q.choices.forEach(function (c, i) {
    var n = i + 1;
    var isC = q.correct.indexOf(n) >= 0;
    var isSel = selected.indexOf(n) >= 0;
    var cls = 'choice' + (isC ? ' correct' : (isSel ? ' wrong' : ''));
    var mk = isC ? '✓' : (isSel ? '✕' : n);
    var tag = isSel ? ' <span class="yourpick">あなたの回答</span>' : '';
    h += '<div class="' + cls + '"><span class="mk">' + mk + '</span><span>' + esc(c) + tag + '</span></div>';
  });
  return h;
}
/* 解説ブロック: Gemini解説を主、CSV解説を「詳しい解説」に。gtextで上書き可 */
function explBlock(q, gtext) {
  if (gtext === undefined) gtext = q.gemini;
  if (gtext) {
    var h = '<div class="q-section-label small muted" style="margin-top:12px">解説 <span class="tag">Gemini</span></div>' +
      '<div class="expl">' + mdToHtml(gtext) + '</div>';
    if (q.explanation) {
      h += '<details class="moredetail"><summary>📄 詳しい解説（原文）を表示</summary>' +
        '<div class="expl">' + esc(q.explanation) + '</div></details>';
    }
    return h;
  }
  if (q.explanation) {
    return '<div class="q-section-label small muted" style="margin-top:12px">解説</div>' +
      '<div class="expl">' + esc(q.explanation) + '</div>';
  }
  return '<div class="empty small">解説データなし</div>';
}

/* ============================ 画面 ============================ */
var state = { view: 'home', exam: null, review: null };

function setNav(view) {
  var btns = document.querySelectorAll('#tabbar button');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-nav') === view);
  }
}
var NAV_MAP = {
  home: 'home', import: 'import', exam: 'exam', examSetup: 'exam', examRun: 'exam', examResult: 'exam',
  practice: 'practice', practiceSetup: 'practice', practiceRun: 'practice',
  review: 'review', reviewRun: 'review', stats: 'stats', statsDeck: 'stats', schedule: 'home', flash: 'home'
};
function show(view, arg) {
  state.view = view;
  if (NAV_MAP[view]) setNav(NAV_MAP[view]);
  document.body.classList.toggle('exam-wide', view === 'examRun');  // PC幅の2カラム出題
  document.body.setAttribute('data-view', view);   // PC幅で画面ごとのレイアウト出し分け用
  if (view !== 'flash' && typeof Speech !== 'undefined') Speech.cancel();   // フラッシュ離脱で読み上げ停止
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
  else if (view === 'import') renderImport();
  else if (view === 'exam') renderExamHub();
  else if (view === 'review') renderReviewHub();
  else if (view === 'stats') renderStatsHub();
  else if (view === 'examSetup') renderExamSetup(arg);
  else if (view === 'examRun') renderExamRun();
  else if (view === 'examResult') renderExamResult(arg);
  else if (view === 'reviewRun') renderReviewRun(arg);
  else if (view === 'statsDeck') renderStatsDeck(arg);
  else if (view === 'practice') renderPracticeSetup();
  else if (view === 'practiceSetup') renderPracticeSetup(arg);
  else if (view === 'practiceRun') renderPracticeRun();
  else if (view === 'login') renderLogin();
  else if (view === 'hwResult') renderHwResult();
  else if (view === 'flash') renderFlash();
  else if (view === 'homework') renderHomework();
  else if (view === 'schedule') renderSchedule();
  updateDeckChip();
  decorateGlossary();
}

/* ============================ 用語集（クリックで意味表示） ============================ */
var _glossRe;
function glossRe() {
  if (_glossRe !== undefined) return _glossRe;
  if (!window.GLOSSARY) { _glossRe = false; return false; }
  var terms = Object.keys(GLOSSARY).filter(function (t) { return t.length >= 2; });
  terms.sort(function (a, b) { return b.length - a.length; }); // 長い語を優先
  var esc = terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  try { _glossRe = new RegExp(esc.join('|'), 'g'); } catch (e) { _glossRe = false; }
  return _glossRe;
}
/* .expl 内のテキストで、用語の初出をクリック可能にする */
function decorateGlossary() {
  var re = glossRe(); if (!re) return;
  var boxes = app.querySelectorAll('.expl');
  for (var b = 0; b < boxes.length; b++) {
    var box = boxes[b];
    var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [], node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.parentNode && nd.parentNode.closest && nd.parentNode.closest('.gloss')) continue;
      var s = nd.nodeValue;
      re.lastIndex = 0;
      if (!re.test(s)) continue;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment(), last = 0, m, used = false;
      while ((m = re.exec(s))) {
        var term = m[0];
        used = true;                       // 出現するたびにリンク化
        frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var span = document.createElement('span');
        var ty = (GLOSSARY[term] && GLOSSARY[term].t) || 'it';
        span.className = 'gloss ' + ty; span.setAttribute('data-act', 'gloss'); span.setAttribute('data-term', term);
        span.textContent = term;
        frag.appendChild(span);
        last = m.index + term.length;
      }
      if (used) { frag.appendChild(document.createTextNode(s.slice(last))); nd.parentNode.replaceChild(frag, nd); }
    }
  }
}
function showGloss(term) {
  var e = window.GLOSSARY && GLOSSARY[term]; if (!e) return;
  var old = document.getElementById('glossSheet'); if (old) old.remove();
  var sheet = document.createElement('div');
  sheet.id = 'glossSheet'; sheet.className = 'gloss-sheet';
  var tlabel = e.t === 'aws' ? '<span class="pill hi">AWS用語</span>' : '<span class="pill">IT用語</span>';
  sheet.innerHTML = '<div class="gloss-card">' +
    '<div class="row"><b class="grow" style="font-size:16px">' + esc(term) + '</b>' +
    tlabel + (e.c ? '<span class="pill g">章 ' + esc(e.c) + '</span>' : '') +
    '<button class="btn ghost sm" data-act="glossClose">✕</button></div>' +
    '<div style="margin-top:10px;line-height:1.8;font-size:14px">' + esc(e.d) + '</div></div>';
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

/* ---------- ホーム ---------- */
function renderHome() {
  var decks = Store.decks();
  var html = nextActionCard();   // 🎯 今これをやろう（迷わない次の一手）
  html += activeDeckCard(decks);
  html += quickFocusCard();   // ⚡ サクッと集中（最重要から数問だけ）
  html += studyCalendarCard();   // 🔥 学習カレンダー（継続の見える化）
  html += scheduleHomeCard();
  if (API.available) html += homeHwCard();   // サーバー接続時のみ「今日の宿題」
  // 中断した試験の再開バナー
  var ae = loadActiveExam();
  if (ae) {
    var doneA = Object.keys(ae.answers || {}).filter(function (k) { return ae.answers[k] && ae.answers[k].length; }).length;
    html += '<div class="card" style="border-color:var(--warn)">' +
      '<div class="row"><div class="grow"><b>⏸ 中断中の試験があります</b>' +
      '<div class="small muted">' + esc(deckLabel(ae.deckName)) + '：' + ae.qs.length + '問中 ' + doneA + '問 回答済</div></div></div>' +
      '<div class="btnrow" style="margin-top:10px">' +
      '<button class="btn primary grow" data-act="resumeExam">▶ 再開する</button>' +
      '<button class="btn ghost danger" data-act="discardExam">破棄</button></div></div>';
  }
  if (!decks.length) {
    html += '<div class="card"><h3>ようこそ 👋</h3>' +
      '<p class="muted small">AWS SAA-C03 模試をスマホで学習するアプリです。問題データは<b>端末内だけ</b>に保存され、ネットには送信されません。</p>' +
      '<p class="small">まずは問題CSVを取り込みましょう（既存の <code class="k">模試N_問題集.csv</code> が使えます）。</p>' +
      '<button class="btn primary block" data-act="goImport">📥 問題を取り込む</button></div>';
  } else {
    html += '<div class="card"><div class="row"><h3 class="grow" style="margin:0">マイデッキ</h3>' +
      '<button class="btn sm" data-act="goImport">＋取込</button></div></div>';
    decks.forEach(function (d) {
      var at = Store.attempts(d.id);
      var last = at.length ? at[at.length - 1] : null;
      var lastTxt = last ? (pct(last.correctCount, last.total) + '%（' + last.correctCount + '/' + last.total + '）') : '未受験';
      var best = 0; at.forEach(function (a) { best = Math.max(best, pct(a.correctCount, a.total)); });
      var gc = d.questions.filter(function (q) { return q.gemini; }).length;
      html += '<div class="card">' +
        '<div class="row"><div class="grow"><b style="font-size:17px">' + esc(deckLabel(d.name)) + '</b>' +
        (d.hasChecklist ? ' <span class="tag">章分類済</span>' : '') +
        (gc > 0 ? ' <span class="tag">Gemini解説 ' + gc + '/' + d.count + '</span>' : '') +
        '<div class="small muted">' + d.count + '問 ・ 受験' + at.length + '回 ・ 直近 ' + lastTxt + (at.length ? ' ・ ベスト ' + best + '%' : '') + '</div></div></div>' +
        '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn primary sm" data-act="startExam" data-id="' + esc(d.id) + '">📝 試験</button>' +
        '<button class="btn sm" data-act="openReview" data-id="' + esc(d.id) + '">📖 解説</button>' +
        '<button class="btn sm" data-act="openStats" data-id="' + esc(d.id) + '">📊 弱点</button>' +
        '<button class="btn ghost sm danger" data-act="delDeck" data-id="' + esc(d.id) + '">🗑</button>' +
        '</div></div>';
    });
  }
  // 設定（文字サイズ）＋ バックアップ
  var f = Settings.get().font || 1;
  html += '<div class="card"><h3>⚙ 設定・データ</h3>' +
    '<div class="row wrap" style="gap:8px;align-items:center">' +
    '<span class="small muted">文字サイズ</span>' +
    '<button class="btn sm' + (f === 0 ? ' primary' : '') + '" data-act="setFont" data-f="0">小</button>' +
    '<button class="btn sm' + (f === 1 ? ' primary' : '') + '" data-act="setFont" data-f="1">中</button>' +
    '<button class="btn sm' + (f === 2 ? ' primary' : '') + '" data-act="setFont" data-f="2">大</button>' +
    '</div>' +
    '<div class="btnrow" style="margin-top:10px">' +
    '<button class="btn sm grow" data-act="backup">💾 バックアップ書出</button>' +
    '<button class="btn sm grow" data-act="restore">📂 復元（読込）</button>' +
    '</div>' +
    '<p class="small muted" style="margin:8px 0 0">データは端末内のみ。機種変更やブラウザ初期化に備え、たまにバックアップを。</p>' +
    '<input type="file" id="restoreFile" accept=".json" style="display:none" /></div>';
  app.innerHTML = html;
  var ads = $('#activeDeckSel');
  if (ads) ads.addEventListener('change', function () { ActiveDeck.set(this.value); show('home'); });
  var rf = $('#restoreFile');
  if (rf) rf.addEventListener('change', function () { doRestore(rf.files); });
}

function renderSchedule() {
  var scopeId = ActiveDeck.deckId();
  var scope = scopeId ? ActiveDeck.label() : '全デッキ横断';
  var today = ymdLocal(new Date());
  var ss = scheduleStats(scopeId);
  var rows = '';
  STUDY_PLAN.forEach(function (d) {
    var actual = reviewedCountOn(scopeId, d.date);
    var left = daysUntilLocalDate(d.date);
    var target = d.target != null ? d.target : ss.daily;
    var isToday = d.date === today;
    var done = d.date < today ? (target === 0 || actual >= target) : false;
    var klass = 'schedule-row' + (isToday ? ' today' : '') + (done ? ' done' : '');
    rows += '<div class="' + klass + '">' +
      '<div class="schedule-date"><b>' + esc(jpDateLabel(d.date)) + '</b><span>残り' + left + '日</span></div>' +
      '<div class="schedule-main"><div class="row"><b class="grow">' + esc(d.theme) + '</b>' + (d.shift ? '<span class="pill' + (d.shift === '休' ? ' g' : (/夜勤/.test(d.shift) ? ' hi' : '')) + '">' + esc(d.shift) + '</span>' : '') + (done ? '<span class="pill ok">完了</span>' : (isToday ? '<span class="pill hi">今日</span>' : '')) + '</div>' +
      '<div class="small muted">' + esc(d.focus) + '</div>' +
      '<div class="small schedule-progress">目標 <b>' + target + '</b>問 / 実績 <b>' + actual + '</b>問</div>' +
      '<div class="bar"><i style="width:' + pct(Math.min(actual, Math.max(target, 1)), Math.max(target, 1)) + '%"></i></div></div></div>';
  });
  app.innerHTML = '<div class="card schedule-hero">' +
    '<div class="row"><button class="btn ghost sm" data-act="home">← ホーム</button><h3 class="grow" style="margin:0">学習スケジュール</h3></div>' +
    '<div class="small muted" style="margin-top:8px">本番 2026/7/14 まで残り' + daysUntilLocalDate(SCHEDULE_EXAM_DATE) + '日・対象: <b>' + esc(scope) + '</b></div>' +
    '<div class="kpi" style="margin-top:10px">' +
    '<div class="b"><b>' + ss.remain + '</b><span class="small muted">残り誤答</span></div>' +
    '<div class="b"><b>' + ss.daily + '</b><span class="small muted">1日あたり目安</span></div>' +
    '<div class="b"><b>' + ss.review.omoiRemain + '</b><span class="small muted">思い込み残</span></div></div>' +
    '<div class="btnrow" style="margin-top:10px">' +
    '<button class="btn primary grow" data-act="startHw">今日の宿題を開く</button>' +
    '<button class="btn grow" data-act="hwReview">誤答の見直し</button></div></div>' +
    '<div class="schedule-list">' + rows + '</div>';
}

/* ---------- 取込 ---------- */
function renderImport() {
  app.innerHTML =
    '<div class="card"><h3>📥 問題を取り込む</h3>' +
    '<p class="small muted">ファイルを選ぶ／ここにドラッグ＆ドロップ。問題は端末内のみに保存されます。</p>' +
    '<div class="drop" id="drop">' +
    '<div style="font-size:34px">🗂️</div><div>タップしてファイルを選択<br><span class="small muted">または ここにドロップ</span></div>' +
    '<input type="file" id="file" accept=".csv,.md,.json" multiple style="display:none" /></div>' +
    '<div class="spacer"></div>' +
    '<p class="small muted">対応ファイル：<br>① <code class="k">○○_問題集.csv</code>（必須／問題・選択肢・正解・解説）<br>' +
    '② <code class="k">○○_章別チェックリスト.csv</code>（任意／ジャンル分類を精密化）<br>' +
    '③ <code class="k">○○_Gemini解説.json</code> または <code class="k">.md</code>（任意／Gemini解説を表示）<br>' +
    '同じ模試のファイルをまとめて選ぶと自動で1デッキに統合します（模試② と 模試2 は同じ扱い）。</p>' +
    '</div>';
  var drop = $('#drop'), file = $('#file');
  drop.addEventListener('click', function () { file.click(); });
  file.addEventListener('change', function () { handleFiles(file.files); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
}
function handleFiles(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  // 問題集→チェックリスト→Gemini解説 の順に処理（統合のため）
  function rank(f) {
    if (/Gemini解説/.test(f.name) || /\.(md|json)$/i.test(f.name)) return 2;
    if (/チェックリスト/.test(f.name)) return 1;
    return 0;
  }
  files.sort(function (a, b) { return rank(a) - rank(b); });
  var log = [];
  // 順番に1つずつ処理（問題集を先に保存してから解説/章別を適用する。並列だと順序が崩れるため）
  function readNext(i) {
    if (i >= files.length) { toast(log.join(' / ')); show('home'); return; }
    var f = files[i], rd = new FileReader();
    rd.onload = function () {
      try { log.push(importOne(f.name, String(rd.result))); }
      catch (e) { log.push('⚠ ' + f.name + '：' + (e.message || '読み込み失敗')); }
      readNext(i + 1);
    };
    rd.onerror = function () { log.push('⚠ ' + f.name + '：読込エラー'); readNext(i + 1); };
    rd.readAsText(f, 'utf-8');
  }
  readNext(0);
}
function importOne(fname, text) {
  var name = deckNameFromFile(fname);
  // Gemini解説JSON（{ "1":"...", ... }）
  if (/\.json$/i.test(fname)) {
    var dj = Store.getDeck(name);
    if (!dj) throw new Error('先に「' + name + '」の問題集CSVを取り込んでください');
    var nj = applyGemini(dj, parseGeminiJson(text));
    if (!nj) throw new Error(name + '：一致する問題番号が0件');
    Store.saveDeck(dj);
    return '✅ ' + name + ' にGemini解説(JSON) ' + nj + '問';
  }
  // Gemini解説md
  if (/\.md$/i.test(fname) || /Gemini解説/.test(fname)) {
    var dg = Store.getDeck(name);
    if (!dg) throw new Error('先に「' + name + '」の問題集CSVを取り込んでください');
    var n = applyGemini(dg, parseGeminiMd(text));
    if (!n) throw new Error(name + '：一致する問題番号が0件');
    Store.saveDeck(dg);
    return '✅ ' + name + ' にGemini解説 ' + n + '問';
  }
  var rows = parseCSV(text);
  if (!rows.length) throw new Error('空ファイル');
  var type = detectCsvType(rows);
  if (type === 'questions') {
    var qs = buildQuestions(rows);
    if (!qs.length) throw new Error('問題が0件');
    var existing = Store.getDeck(name);
    if (existing) { // 再取込時に既存のGemini解説・章分類を引き継ぐ
      var oldByNum = {};
      existing.questions.forEach(function (q) { oldByNum[q.num] = q; });
      qs.forEach(function (q) {
        var o = oldByNum[q.num];
        if (!o) return;
        if (o.gemini) q.gemini = o.gemini;
        if (existing.hasChecklist) { q.genre = o.genre; q.genreCode = o.genreCode; q.importance = o.importance; }
      });
    }
    var deck = {
      id: name, name: name, importedAt: Date.now(), count: qs.length, questions: qs,
      hasChecklist: existing ? existing.hasChecklist : false,
      hasGemini: qs.filter(function (q) { return q.gemini; }).length > 0
    };
    Store.saveDeck(deck);
    return '✅ ' + name + '（' + qs.length + '問）';
  } else if (type === 'checklist') {
    var d = Store.getDeck(name);
    if (!d) throw new Error('先に「' + name + '_問題集.csv」を取り込んでください');
    applyChecklist(d, rows);
    Store.saveDeck(d);
    return '✅ ' + name + ' に章分類を適用';
  } else {
    throw new Error('未対応の形式（問題集/章別チェックリスト/Gemini解説ではない）');
  }
}

/* ---------- 試験ハブ（デッキ選択） ---------- */
function pickDeckCard(actLabel, act) {
  var decks = Store.decks();
  if (!decks.length) {
    return '<div class="card empty">デッキがありません。<br><button class="btn primary" data-act="goImport" style="margin-top:10px">📥 取り込む</button></div>';
  }
  var h = '<div class="card"><h3>' + actLabel + '</h3><p class="small muted">デッキを選択</p>';
  decks.forEach(function (d) {
    var on = ActiveDeck.deckId() === d.id;
    h += '<button class="btn block' + (on ? ' primary' : '') + '" style="justify-content:space-between;margin:6px 0" data-act="' + act + '" data-id="' + esc(d.id) + '">' +
      '<span>' + esc(deckLabel(d.name)) + '</span><span class="small muted">' + d.count + '問</span></button>';
  });
  return h + '</div>';
}
function renderExamHub() {
  var decks = Store.decks();
  if (!decks.length) { app.innerHTML = pickDeckCard('📝 試験モード', 'startExam'); return; }
  var last = LS.get('saa.lastDeck', null);
  var id = ActiveDeck.preferred(last);
  renderExamSetup(id);
}
function renderReviewHub() {
  var id = ActiveDeck.deckId();
  if (id && Store.getDeck(id)) { show('reviewRun', { deckId: id }); return; }
  app.innerHTML = pickDeckCard('📖 解説モード', 'openReview');
}
function renderStatsHub() {
  var id = ActiveDeck.deckId();
  if (id && Store.getDeck(id)) { show('statsDeck', id); return; }
  app.innerHTML = pickDeckCard('📊 弱点分析', 'openStats');
}

/* ============================ 練習モード ============================ */
function renderPracticeSetup(deckId) {
  var decks = Store.decks();
  if (!decks.length) { app.innerHTML = pickDeckCard('🎯 練習モード', 'startPractice'); return; }
  if (!deckId || !Store.getDeck(deckId)) deckId = ActiveDeck.preferred(LS.get('saa.lastDeck', decks[0].id));
  if (!Store.getDeck(deckId)) deckId = decks[0].id;
  var d = Store.getDeck(deckId);
  state.pSetup = deckId;
  var genres = deckGenres(d);
  var deckOpts = decks.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === deckId ? ' selected' : '') + '>' + esc(deckLabel(x.name)) + '（' + x.count + '問）</option>'; }).join('');
  var gopts = genres.map(function (g) { return '<option value="' + esc(g.code) + '">' + esc(g.name) + '（' + g.count + '）</option>'; }).join('');
  app.innerHTML =
    '<div class="card"><h3>🎯 練習モード</h3>' +
    '<p class="small muted">1問ずつ答え合わせ＆解説。気軽に反復できます（成績は弱点分析に反映、受験履歴には残りません）。</p>' +
    '<label class="fld"><span class="lab">① どの模試</span><select id="pDeck">' + deckOpts + '</select></label>' +
    '<label class="fld"><span class="lab">② 出題範囲</span><select id="pRange">' +
    '<option value="all">ランダム（全問から）</option>' +
    '<option value="genre">ジャンル（章）を指定</option>' +
    '<option value="weak">苦手（正答率60%未満・未挑戦）</option>' +
    '<option value="bm">★ ブックマークのみ</option>' +
    '</select></label>' +
    '<label class="fld" id="pGenreWrap" style="display:none"><span class="lab">ジャンル</span><select id="pGenre">' + gopts + '</select></label>' +
    '<label class="fld"><span class="lab">③ 問題数</span><select id="pCount">' +
    '<option value="10">10問</option><option value="20">20問</option><option value="0">全部</option>' +
    '</select></label>' +
    '<div id="pInfo" class="small muted" style="margin:2px 0 10px"></div>' +
    '<button class="btn primary block" data-act="beginPractice">▶ 練習を始める</button></div>';
  $('#pDeck').addEventListener('change', function () { show('practiceSetup', this.value); });
  $('#pRange').addEventListener('change', function () { $('#pGenreWrap').style.display = this.value === 'genre' ? 'block' : 'none'; upd(); });
  function pool() {
    var d2 = Store.getDeck(deckId), arr = d2.questions.slice(), range = $('#pRange').value;
    if (range === 'genre') { var g = $('#pGenre').value; if (g) arr = arr.filter(function (q) { return q.genreCode === g; }); }
    else if (range === 'weak') { var qs = qStats(deckId); arr = arr.filter(function (q) { var s = qs[q.num]; return !s || s.correct / s.seen < 0.6; }); }
    else if (range === 'bm') { var bm = BM.list(deckId); arr = arr.filter(function (q) { return bm.indexOf(q.num) >= 0; }); }
    return arr;
  }
  function upd() { var n = pool().length, c = parseInt($('#pCount').value, 10) || 0; $('#pInfo').textContent = '対象 ' + n + '問' + (c > 0 ? ' → ' + Math.min(c, n) + '問を出題' : ''); }
  ['#pGenre', '#pCount'].forEach(function (s) { var e = $(s); if (e) e.addEventListener('change', upd); });
  upd();
  state._pPool = pool; // beginPractice から使う
}
function beginPractice() {
  var d = Store.getDeck(state.pSetup); if (!d) return;
  var arr = state._pPool ? state._pPool() : d.questions.slice();
  if (!arr.length) { toast('対象の問題がありません'); return; }
  arr = shuffle(arr);
  var c = parseInt($('#pCount').value, 10) || 0;
  if (c > 0 && arr.length > c) arr = arr.slice(0, c);
  LS.set('saa.lastDeck', d.id);
  state.practice = { deckId: d.id, deckName: d.name, qs: arr, idx: 0, sel: [], revealed: false, seen: 0, correct: 0 };
  show('practiceRun');
}
function renderPracticeRun() {
  var p = state.practice; if (!p) return show('practice');
  var q = p.qs[p.idx];
  var multi = q.correct.length > 1 || /[2２]\s*つ選択|複数選択|該当するもの全て|すべて選択/.test(q.text);
  var ch = '';
  if (p.revealed) {
    ch = choicesView(q, p.sel);
  } else {
    q.choices.forEach(function (c, i) {
      var n = i + 1, on = p.sel.indexOf(n) >= 0;
      ch += '<button class="choice' + (on ? ' sel' : '') + '" data-act="pPick" data-n="' + n + '"><span class="mk">' + (on ? '✓' : n) + '</span><span>' + esc(c) + '</span></button>';
    });
  }
  var bottom = p.revealed
    ? (p.idx < p.qs.length - 1 ? '<button class="btn primary grow" data-act="pNext">次の問題 →</button>' : '<button class="btn primary grow" data-act="pNext">結果を見る</button>')
    : '<button class="btn primary grow" data-act="pReveal" ' + (p.sel.length ? '' : 'disabled') + '>答え合わせ</button>';
  app.innerHTML =
    '<div class="card" style="margin-top:6px">' +
    '<div class="qmeta"><span>🎯 練習 ' + (p.idx + 1) + ' / ' + p.qs.length + '</span><span>正解 ' + p.correct + ' / ' + p.seen + '</span></div>' +
    '<div class="bar"><i style="width:' + pct(p.idx + (p.revealed ? 1 : 0), p.qs.length) + '%"></i></div>' +
    '<div class="row wrap" style="margin-top:10px;gap:6px">' +
    '<span class="pill g">' + esc(q.genre) + '</span>' +
    '<span class="pill' + (q.importance === '高' ? ' hi' : '') + '">重要度 ' + esc(q.importance) + '</span>' +
    (multi ? '<span class="pill">複数選択可</span>' : '') +
    '<span class="grow"></span>' +
    '<button class="btn ghost sm" data-act="pBm" data-num="' + q.num + '">' + (BM.has(p.deckId, q.num) ? '★' : '☆') + '</button>' +
    '</div>' +
    '<div class="qtext">' + esc(q.text) + '</div>' + ch +
    (p.revealed ? ('<div class="small ' + (p.lastOk ? 'okc' : 'ngc') + '" style="margin-top:6px">' + (p.lastOk ? '正解！ ✓' : '不正解… ✕') + '</div>' + explBlock(q, effExpl(p.deckId, q))) : '') +
    '</div>' +
    '<div class="sticky-bottom">' + bottom + '</div>' +
    '<div class="spacer"></div>' +
    '<button class="btn ghost block sm" data-act="pQuit">練習をやめる</button>';
  decorateGlossary();
}
function pPick(n) {
  var p = state.practice, q = p.qs[p.idx];
  if (p.revealed) return;
  var multi = q.correct.length > 1 || /[2２]\s*つ選択|複数選択|該当するもの全て|すべて選択/.test(q.text);
  var pos = p.sel.indexOf(n);
  if (multi) { if (pos >= 0) p.sel.splice(pos, 1); else p.sel.push(n); }
  else { p.sel = (pos >= 0) ? [] : [n]; }
  renderPracticeRun();
}
function pReveal() {
  var p = state.practice, q = p.qs[p.idx];
  if (!p.sel.length) return;
  p.revealed = true;
  p.lastOk = eqSet(p.sel, q.correct);
  p.seen++; if (p.lastOk) p.correct++;
  PStats.record(p.deckId, q.num, p.lastOk);
  renderPracticeRun();
}
function pNext() {
  var p = state.practice;
  if (p.idx < p.qs.length - 1) { p.idx++; p.sel = []; p.revealed = false; renderPracticeRun(); }
  else { renderPracticeResult(); }
}
function renderPracticeResult() {
  var p = state.practice;
  app.innerHTML =
    '<div class="card" style="text-align:center">' +
    '<div class="small muted">🎯 練習おつかれさま（' + esc(deckLabel(p.deckName)) + '）</div>' +
    '<div class="bigpct">' + pct(p.correct, p.seen) + '%</div>' +
    '<div class="muted">' + p.correct + ' / ' + p.seen + ' 正解</div></div>' +
    '<div class="btnrow">' +
    '<button class="btn primary grow" data-act="practiceAgain" data-id="' + esc(p.deckId) + '">もう一度</button>' +
    '<button class="btn grow" data-act="openStats" data-id="' + esc(p.deckId) + '">📊 弱点</button></div>' +
    '<button class="btn ghost block" data-act="home" style="margin-top:8px">🏠 ホーム</button>';
  state.practice = null;
}

/* ---------- 試験セットアップ（模試選択・章絞り・低正答率絞り・問題数 を組合せ可） ---------- */
function renderExamSetup(deckId) {
  var decks = Store.decks();
  if (!decks.length) { app.innerHTML = pickDeckCard('📝 試験モード', 'startExam'); return; }
  if (!deckId || !Store.getDeck(deckId)) deckId = ActiveDeck.preferred(LS.get('saa.lastDeck', decks[0].id));
  var d = Store.getDeck(deckId);
  state.setupDeck = deckId;
  var genres = deckGenres(d);
  var deckOpts = decks.map(function (x) {
    return '<option value="' + esc(x.id) + '"' + (x.id === deckId ? ' selected' : '') + '>' + esc(deckLabel(x.name)) + '（' + x.count + '問）</option>';
  }).join('');
  var gopts = '<option value="">全ジャンル（章）</option>' + genres.map(function (g) {
    return '<option value="' + esc(g.code) + '">' + esc(g.name) + '（' + g.count + '）</option>';
  }).join('');
  app.innerHTML =
    '<div class="card"><h3>📝 試験モード</h3>' +
    '<label class="fld"><span class="lab">① どの模試を使う？</span><select id="deckSel">' + deckOpts + '</select></label>' +
    '<label class="fld"><span class="lab">② 章（ジャンル）で絞る</span><select id="genre">' + gopts + '</select></label>' +
    '<label class="fld"><span class="lab">③ 正答率の低い問題に絞る</span>' +
    '<label class="rowcheck"><input type="checkbox" id="weakOn"> <span>苦手な問題だけ出題する</span></label>' +
    '<select id="thr" style="margin-top:8px">' +
    '<option value="0.6">正答率 60%未満（未受験も含む）</option>' +
    '<option value="0.5">正答率 50%未満</option>' +
    '<option value="0.8">正答率 80%未満</option>' +
    '<option value="1">1度でも間違えた問題</option>' +
    '</select></label>' +
    '<label class="rowcheck" style="margin-top:6px"><input type="checkbox" id="bmOn"> <span>★ ブックマークした問題だけ（' + BM.list(deckId).length + '問）</span></label>' +
    '<label class="fld"><span class="lab">④ 問題数</span><select id="count">' +
    '<option value="0">条件すべて</option><option value="10">10問</option><option value="20">20問</option><option value="30">30問</option><option value="65">65問</option>' +
    '</select></label>' +
    '<label class="fld"><span class="lab">⑤ 出題順</span><select id="order"><option value="shuffle">シャッフル</option><option value="seq">番号順</option></select></label>' +
    '<label class="rowcheck"><input type="checkbox" id="shuffleCh"> <span>🔀 選択肢の順番もシャッフル（位置で覚えるのを防止）</span></label>' +
    '<label class="rowcheck"><input type="checkbox" id="studyOn"> <span>📖 解説を見ながら（1問ずつ即採点）</span></label>' +
    '<div id="poolInfo" class="small muted" style="margin:6px 0 10px"></div>' +
    '<button class="btn primary block" data-act="beginExam">▶ 開始</button>' +
    '</div>';
  $('#deckSel').addEventListener('change', function () { show('examSetup', this.value); });
  function upd() {
    var base = gatherFilters(d);
    var count = parseInt($('#count').value, 10) || 0;
    var out = count > 0 ? Math.min(count, base.length) : base.length;
    $('#poolInfo').textContent = '条件に合致 ' + base.length + '問 → 出題 ' + out + '問';
  }
  ['#genre', '#weakOn', '#thr', '#count', '#bmOn'].forEach(function (s) { var e = $(s); if (e) e.addEventListener('change', upd); });
  upd();
}
function gatherFilters(d) {
  var g = $('#genre') ? $('#genre').value : '';
  var weakOn = $('#weakOn') ? $('#weakOn').checked : false;
  var bmOn = $('#bmOn') ? $('#bmOn').checked : false;
  var thr = $('#thr') ? parseFloat($('#thr').value) : 0.6;
  var pool = d.questions.slice();
  if (g) pool = pool.filter(function (q) { return q.genreCode === g; });
  if (bmOn) { var bm = BM.list(d.id); pool = pool.filter(function (q) { return bm.indexOf(q.num) >= 0; }); }
  if (weakOn) {
    var qs = qStats(d.id);
    pool = pool.filter(function (q) {
      var s = qs[q.num];
      if (!s) return true;            // 未受験＝苦手扱い
      return (s.correct / s.seen) < thr;
    });
  }
  return pool;
}
function buildExamPool(d) {
  var pool = gatherFilters(d);
  if (!pool.length) { toast('条件に合う問題がありません'); return null; }
  var order = $('#order').value, count = parseInt($('#count').value, 10) || 0;
  pool = order === 'shuffle' ? shuffle(pool) : pool.sort(function (a, b) { return a.num - b.num; });
  if (count > 0 && pool.length > count) pool = pool.slice(0, count);
  return pool;
}
function beginExam() {
  var d = Store.getDeck(state.setupDeck); if (!d) return;
  var pool = buildExamPool(d); if (!pool) return;
  LS.set('saa.lastDeck', d.id);
  var study = $('#studyOn') ? $('#studyOn').checked : false;
  var shuffleCh = $('#shuffleCh') ? $('#shuffleCh').checked : false;
  var perm = {};
  if (shuffleCh) {
    pool.forEach(function (q) {
      var r = []; for (var i = 1; i <= q.choices.length; i++) r.push(i);
      perm[q.num] = shuffle(r);
    });
  }
  state.exam = {
    deckId: d.id, deckName: d.name, qs: pool, idx: 0,
    answers: {}, flags: {}, startedAt: Date.now(),
    study: study, revealed: {}, shuffleCh: shuffleCh, perm: perm
  };
  saveActiveExam();
  show('examRun');
}

/* ---------- 試験 実行 ---------- */
function renderExamRun() {
  var ex = state.exam; if (!ex) return show('exam');
  var q = ex.qs[ex.idx];
  var total = ex.qs.length;
  var answered = Object.keys(ex.answers).filter(function (k) { return ex.answers[k] && ex.answers[k].length; }).length;
  var sel = ex.answers[q.num] || [];
  var multi = q.correct.length > 1 || /[2２]\s*つ選択|複数選択|該当するもの全て|すべて選択/.test(q.text);

  var revealed = ex.study && ex.revealed[q.num];
  var order = (ex.shuffleCh && ex.perm[q.num]) ? ex.perm[q.num] : q.choices.map(function (_, i) { return i + 1; });
  var ch = '';
  order.forEach(function (orig, p) {
    var on = sel.indexOf(orig) >= 0;
    var text = esc(q.choices[orig - 1]);
    if (revealed) {
      var isC = q.correct.indexOf(orig) >= 0;
      var cls = 'choice' + (isC ? ' correct' : (on ? ' wrong' : ''));
      var mk = isC ? '✓' : (on ? '✕' : (p + 1));
      var tag = on ? ' <span class="yourpick">あなたの回答</span>' : '';
      ch += '<div class="' + cls + '"><span class="mk">' + mk + '</span><span>' + text + tag + '</span></div>';
    } else {
      ch += '<button class="choice' + (on ? ' sel' : '') + '" data-act="pick" data-n="' + orig + '">' +
        '<span class="mk">' + (on ? '✓' : (p + 1)) + '</span><span>' + text + '</span></button>';
    }
  });

  var bottom;
  if (ex.study && !revealed) {
    bottom = '<button class="btn" data-act="prevQ" ' + (ex.idx === 0 ? 'disabled' : '') + '>← 前</button>' +
      '<button class="btn primary grow" data-act="reveal" ' + (sel.length ? '' : 'disabled') + '>答え合わせ</button>';
  } else {
    bottom = '<button class="btn" data-act="prevQ" ' + (ex.idx === 0 ? 'disabled' : '') + '>← 前</button>' +
      (ex.idx === total - 1
        ? '<button class="btn primary grow" data-act="finishExam">' + (ex.study ? '結果を見る' : '採点する') + '</button>'
        : '<button class="btn primary grow" data-act="nextQ">次へ →</button>');
  }

  var qidLabel = qIdForExam(ex, q);
  app.innerHTML =
    '<div class="card exam-card" style="margin-top:6px">' +
    '<div class="qmeta"><span>問題 ' + (ex.idx + 1) + ' / ' + total + ' ・ 回答済 ' + answered + (ex.study ? ' ・ 📖学習' : '') + '</span>' +
    '<span id="timer">⏱ 0:00</span></div>' +
    '<div class="bar"><i style="width:' + pct(ex.idx + 1, total) + '%"></i></div>' +
    '<div class="row wrap" style="margin-top:10px;gap:6px">' +
    '<span class="pill id">🆔 ' + esc(qidLabel) + '</span>' +
    '<span class="pill g">' + esc(q.genre) + '</span>' +
    '<span class="pill' + (q.importance === '高' ? ' hi' : '') + '">重要度 ' + esc(q.importance) + '</span>' +
    (ex.hw && q._why ? '<span class="pill hi">📅 ' + esc(q._why) + '</span>' : '') +
    (multi ? '<span class="pill">複数選択可</span>' : '') +
    '<span class="grow"></span>' +
    '<button class="btn ghost sm" data-act="bmEx">' + (BM.has(qDeckId(q), q.num) ? '★' : '☆') + '</button>' +
    '<button class="btn ghost sm" data-act="flag">' + (ex.flags[q.num] ? '🚩' : '🏳') + '</button>' +
    '</div>' +
    '<div class="exam-grid">' +
    '<div class="exam-q"><div class="qtext">' + esc(q.text) + '</div></div>' +
    '<div class="exam-choices"><div class="exam-col-label small muted">選択肢</div>' + ch + '</div>' +
    '<div class="exam-expl">' +
    confSectionHtml(qDeckId(q), q) +
    (revealed ? ('<div class="exam-col-label small muted">解答・解説</div>' + explBlock(q, effExpl(qDeckId(q), q))) : '') +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="card"><div class="navgrid">' + navGridHtml() + '</div></div>' +
    '<div class="sticky-bottom">' + bottom + '</div>' +
    '<div class="spacer"></div>' +
    '<button class="btn ghost block danger sm" data-act="quitExam">試験を中断</button>';
  startTimer();
  saveActiveExam();
  decorateGlossary();
  bindConfInputs(qDeckId(q));
}
function navGridHtml() {
  var ex = state.exam, h = '';
  ex.qs.forEach(function (q, i) {
    var ans = ex.answers[q.num] && ex.answers[q.num].length;
    var c = '';
    if (ex.study && ex.revealed[q.num]) { c += (eqSet(ex.answers[q.num] || [], q.correct) ? 'ok ' : 'ng '); }
    else if (ans) { c += 'ans '; }
    c += (ex.flags[q.num] ? 'flag ' : '') + (i === ex.idx ? 'cur' : '');
    h += '<button class="' + c + '" data-act="jump" data-i="' + i + '">' + (i + 1) + '</button>';
  });
  return h;
}
var _timer = null;
function startTimer() {
  if (_timer) clearInterval(_timer);
  function upd() {
    var el = $('#timer'); if (!el || !state.exam) { clearInterval(_timer); return; }
    var s = Math.floor((Date.now() - state.exam.startedAt) / 1000);
    el.textContent = '⏱ ' + Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  upd(); _timer = setInterval(upd, 1000);
}
function pickChoice(n) {
  var ex = state.exam, q = ex.qs[ex.idx];
  if (ex.study && ex.revealed[q.num]) return; // 採点後は変更不可
  var sel = ex.answers[q.num] || [];
  var multi = q.correct.length > 1 || /[2２]\s*つ選択|複数選択|すべて選択|該当するもの全て/.test(q.text);
  var pos = sel.indexOf(n);
  if (multi) {
    if (pos >= 0) sel.splice(pos, 1); else sel.push(n);
  } else {
    sel = (pos >= 0) ? [] : [n];
  }
  ex.answers[q.num] = sel;
  renderExamRun();
}
function revealAnswer() {
  var ex = state.exam, q = ex.qs[ex.idx];
  if (!(ex.answers[q.num] && ex.answers[q.num].length)) return;
  ex.revealed[q.num] = true;
  if (ex.hw) {   // 宿題/見直しは「答え合わせ」した時点で1問ずつ即採点・即同期（途中離脱でも残る）
    ex.graded = ex.graded || {};
    if (!ex.graded[q.num]) {
      SRS.grade(q._deck || ex.deckId, q.num, eqSet(ex.answers[q.num], q.correct));
      ex.graded[q.num] = true;
      HwStreak.bump();
    }
  }
  renderExamRun();
}
function finishExam() {
  var ex = state.exam;
  if (ex.hw) return finishHomework();   // 今日の宿題は別集計（SRS更新・成績には混ぜない）
  var unanswered = ex.qs.filter(function (q) { return !(ex.answers[q.num] && ex.answers[q.num].length); }).length;
  if (unanswered > 0 && !confirm('未回答が ' + unanswered + ' 問あります。採点しますか？（未回答は不正解扱い）')) return;
  if (_timer) clearInterval(_timer);
  var items = ex.qs.map(function (q) {
    var sel = (ex.answers[q.num] || []).slice();
    var ok = sel.length > 0 && eqSet(sel, q.correct);
    return { num: q.num, selected: sel, correct: q.correct.slice(), isCorrect: ok, genreCode: q.genreCode, genre: q.genre };
  });
  var correctCount = items.filter(function (it) { return it.isCorrect; }).length;
  var attempt = {
    deckId: ex.deckId, deckName: ex.deckName, mode: 'exam',
    startedAt: ex.startedAt, finishedAt: Date.now(),
    durationSec: Math.round((Date.now() - ex.startedAt) / 1000),
    total: items.length, correctCount: correctCount, items: items
  };
  Store.addAttempt(ex.deckId, attempt);
  state.lastAttempt = attempt;
  state.lastExamQs = ex.qs.slice();
  state.lastSetup = { deckId: ex.deckId, study: ex.study };
  state.exam = null;
  clearActiveExam();
  show('examResult', attempt);
}

/* ---------- 試験 結果 ---------- */
function renderExamResult(a) {
  if (!a) a = state.lastAttempt;
  var p = pct(a.correctCount, a.total);
  var pass = p >= 72;
  // 前回比（同デッキ・直前の受験）
  var atAll = Store.attempts(a.deckId), prev = null;
  for (var pi = atAll.length - 1; pi >= 0; pi--) { if (atAll[pi].id === a.id) { prev = atAll[pi - 1] || null; break; } }
  var deltaHtml = '';
  if (prev) {
    var pp = pct(prev.correctCount, prev.total), dlt = p - pp;
    deltaHtml = '<div class="small ' + (dlt >= 0 ? 'okc' : 'ngc') + '">前回比 ' + (dlt >= 0 ? '+' : '') + dlt + 'pt（前回 ' + pp + '%）</div>';
  }
  var byG = {};
  a.items.forEach(function (it) {
    var k = it.genreCode || '?';
    var s = byG[k] || (byG[k] = { name: it.genre || k, seen: 0, correct: 0 });
    s.seen++; if (it.isCorrect) s.correct++;
  });
  var gkeys = Object.keys(byG).sort(function (x, y) {
    return (byG[x].correct / byG[x].seen) - (byG[y].correct / byG[y].seen);
  });
  var grows = '';
  gkeys.forEach(function (k) {
    var g = byG[k], gp = pct(g.correct, g.seen);
    var col = gp >= 72 ? 'var(--ok)' : gp >= 50 ? 'var(--warn)' : 'var(--bad)';
    grows += '<tr><td>' + esc(g.name) + '</td><td class="rt">' + g.correct + '/' + g.seen + '</td>' +
      '<td style="width:42%"><div class="meter"><i style="width:' + gp + '%;background:' + col + '"></i></div></td>' +
      '<td class="rt">' + gp + '%</td></tr>';
  });
  var wrong = a.items.filter(function (it) { return !it.isCorrect; });
  var deck = Store.getDeck(a.deckId) || { questions: [] };
  var qmap = {};
  (state.lastExamQs && state.lastExamQs.length ? state.lastExamQs : deck.questions).forEach(function (q) { qmap[q.num] = q; });
  var wrows = '';
  wrong.forEach(function (it) {
    var q = qmap[it.num];
    wrows += '<details class="moredetail" style="margin:6px 0">' +
      '<summary>' + esc(qId(a.deckName || a.deckId, it.num)) + ' <span class="small muted">' + esc(it.genre) + '</span></summary>' +
      '<div style="padding:0 12px 12px">' +
      (q ? ('<div class="qtext" style="font-size:14px">' + esc(q.text) + '</div>' + choicesView(q, it.selected) + explBlock(q) +
        '<div style="margin-top:10px"><button class="btn sm" data-act="bmRes" data-num="' + it.num + '">' + (BM.has(a.deckId, it.num) ? '★ ブックマーク済' : '☆ ブックマーク') + '</button></div>')
        : '<span class="muted small">問題データなし</span>') +
      '</div></details>';
  });

  app.innerHTML =
    '<div class="card" style="text-align:center">' +
    '<div class="small muted">' + esc(deckLabel(a.deckName)) + ' ・ ' + fmtDate(a.finishedAt) + '</div>' +
    '<div class="bigpct" style="color:' + (pass ? 'var(--ok)' : 'var(--bad)') + '">' + p + '%</div>' +
    '<div class="' + (pass ? '' : 'muted') + '">' + (pass ? '🎉 合格ライン(72%)突破！' : '合格ライン 72% まで あと ' + (72 - p) + 'pt') + '</div>' +
    deltaHtml +
    '<div class="kpi" style="margin-top:12px">' +
    '<div class="b"><b>' + a.correctCount + '/' + a.total + '</b><span class="small muted">正解</span></div>' +
    '<div class="b"><b>' + fmtDur(a.durationSec) + '</b><span class="small muted">時間</span></div>' +
    '<div class="b"><b>' + wrong.length + '</b><span class="small muted">不正解</span></div>' +
    '</div></div>' +
    '<div class="card"><h3>ジャンル別 正答率</h3><table class="tbl"><tr><th>ジャンル</th><th class="rt">正答</th><th></th><th class="rt">率</th></tr>' + grows + '</table></div>' +
    (wrong.length ? '<div class="card"><h3>間違えた問題（タップで展開・解説）</h3>' + wrows + '</div>' : '<div class="card empty">全問正解！🎉</div>') +
    '<div class="btnrow">' +
    (wrong.length ? '<button class="btn primary grow" data-act="retryWrong">❌ 間違いだけ復習</button>' : '') +
    '<button class="btn grow" data-act="retrySame">🔁 同じ問題でもう一度</button></div>' +
    '<div class="btnrow"><button class="btn grow" data-act="openStats" data-id="' + esc(a.deckId) + '">📊 弱点</button>' +
    '<button class="btn grow" data-act="home">🏠 ホーム</button></div>';
}

/* ---------- 解説モード ---------- */
function renderReviewRun(arg) {
  var deckId = arg.deckId, d = Store.getDeck(deckId); if (!d) return show('review');
  var backTo = ActiveDeck.deckId() === deckId ? 'home' : 'review';
  var backLabel = ActiveDeck.deckId() === deckId ? '← ホーム' : '← デッキ';
  if (!state.review || state.review.deckId !== deckId) {
    state.review = { deckId: deckId, filter: 'all', genre: '', idx: 0 };
  }
  var rv = state.review;
  if (rv.search == null) rv.search = '';
  if (arg.num != null) { // 特定問題へジャンプ
    rv.filter = 'all'; rv.genre = ''; rv.search = '';
    var fi = d.questions.findIndex(function (q) { return q.num === arg.num; });
    rv.idx = fi >= 0 ? fi : 0;
  }
  var qs = qStats(deckId);
  var lastA = lastAnswerMap(deckId);
  var list = d.questions.slice();
  if (rv.filter === 'wrong') list = list.filter(function (q) { var s = qs[q.num]; return s && s.correct < s.seen; });
  else if (rv.filter === 'bm') list = list.filter(function (q) { return BM.has(deckId, q.num); });
  else if (rv.filter === 'genre' && rv.genre) list = list.filter(function (q) { return q.genreCode === rv.genre; });
  if (rv.search) {
    var kw = rv.search.toLowerCase();
    list = list.filter(function (q) {
      if (('q' + q.num) === kw || String(q.num) === kw) return true;
      return (q.text + ' ' + q.choices.join(' ') + ' ' + (q.explanation || '')).toLowerCase().indexOf(kw) >= 0;
    });
  }
  if (!list.length) {
    app.innerHTML = '<div class="card"><div class="row"><button class="btn ghost sm" data-act="back" data-to="' + backTo + '">' + backLabel + '</button>' +
      '<span class="grow"></span><span class="small muted">' + esc(deckLabel(d.name)) + '</span></div>' +
      reviewToolbar(rv, d) + '<div class="empty">該当する問題がありません</div></div>';
    bindReviewToolbar();
    return;
  }
  if (rv.idx >= list.length) rv.idx = 0;
  var q = list[rv.idx];
  var st = qs[q.num];
  var mine = lastA[q.num];
  var gtext = effExpl(deckId, q);
  var added = !!ExplStore.get(deckId, q.num);

  app.innerHTML =
    '<div class="card" style="margin-top:6px">' +
    '<div class="row"><button class="btn ghost sm" data-act="back" data-to="' + backTo + '">' + backLabel + '</button>' +
    '<span class="grow"></span><span class="small muted">' + esc(deckLabel(d.name)) + '</span></div>' +
    reviewToolbar(rv, d) + '</div>' +
    '<div class="card">' +
    '<div class="qmeta"><span>' + (rv.idx + 1) + ' / ' + list.length + '（Q' + q.num + '）</span>' +
    '<span>' + (st ? '正答 ' + st.correct + '/' + st.seen : '未受験') + '</span></div>' +
    '<div class="row wrap" style="gap:6px;margin:4px 0 8px">' +
    '<span class="pill g">' + esc(q.genre) + '</span>' +
    '<span class="pill' + (q.importance === '高' ? ' hi' : '') + '">重要度 ' + esc(q.importance) + '</span>' +
    '<span class="grow"></span>' +
    '<button class="btn ghost sm" data-act="explEdit" data-num="' + q.num + '">' + (added ? '✏️ 解説編集' : '➕ 解説追加') + '</button>' +
    '<button class="btn ghost sm" data-act="rvBm" data-num="' + q.num + '">' + (BM.has(deckId, q.num) ? '★' : '☆') + '</button>' +
    '</div>' +
    '<div class="qtext">' + esc(q.text) + '</div>' +
    choicesView(q, mine ? mine.selected : []) +
    (mine ? '<div class="small ' + (mine.isCorrect ? 'okc' : 'ngc') + '" style="margin-top:6px">前回のあなた: ' + (mine.isCorrect ? '正解 ✓' : '不正解 ✕') + '</div>' : '') +
    (q.srcVerdict ? '<div class="small ' + (q.srcVerdict === '○' ? 'okc' : 'ngc') + '" style="margin-top:4px">本番(模試): ' + (q.srcVerdict === '○' ? '正解 ✓' : '不正解 ✕') + (q.srcAnswer && q.srcAnswer.length ? '（あなたの回答 ' + q.srcAnswer.join(',') + '）' : '') + '</div>' : '') +
    confSectionHtml(deckId, q) +
    (rv.editing ? explEditor(deckId, q, gtext) : explBlock(q, gtext)) +
    (added && !rv.editing ? '<div class="small muted" style="margin-top:4px">※この解説はアプリで追記したものです</div>' : '') +
    '</div>' +
    '<div class="sticky-bottom">' +
    '<button class="btn" data-act="rvPrev" ' + (rv.idx === 0 ? 'disabled' : '') + '>← 前</button>' +
    '<button class="btn grow" data-act="rvNext" ' + (rv.idx === list.length - 1 ? 'disabled' : '') + '>次へ →</button>' +
    '</div>';
  state.reviewList = list;
  bindReviewToolbar();
  bindConfInputs(deckId);
}
function reviewToolbar(rv, d) {
  var genres = deckGenres(d);
  var gchips = '';
  genres.forEach(function (g) {
    gchips += '<span class="chip' + (rv.filter === 'genre' && rv.genre === g.code ? ' on' : '') + '" data-act="rvGenre" data-g="' + esc(g.code) + '">' + esc(g.name) + '</span>';
  });
  return '<div class="chips" style="margin-top:8px">' +
    '<span class="chip' + (rv.filter === 'all' ? ' on' : '') + '" data-act="rvFilter" data-f="all">全問</span>' +
    '<span class="chip' + (rv.filter === 'wrong' ? ' on' : '') + '" data-act="rvFilter" data-f="wrong">間違えた問題</span>' +
    '<span class="chip' + (rv.filter === 'bm' ? ' on' : '') + '" data-act="rvFilter" data-f="bm">★ ブックマーク</span>' +
    gchips + '</div>' +
    '<input type="text" id="rvSearch" placeholder="🔍 キーワード/番号で検索（例: S3, 12）" value="' + esc(rv.search || '') + '" style="margin-top:8px">';
}
function bindReviewToolbar() {
  var s = $('#rvSearch');
  if (s) {
    s.addEventListener('change', function () { state.review.search = this.value.trim(); state.review.idx = 0; show('reviewRun', { deckId: state.review.deckId }); });
    s.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
  }
}
/* 解説エディタ（アプリ内で追記・編集） */
function explEditor(deckId, q, cur) {
  return '<div class="q-section-label small muted" style="margin-top:12px">✏️ 解説を追記・編集（Markdown可）</div>' +
    '<textarea id="explTA" class="expl-edit" placeholder="Geminiやメモの解説をここに貼り付け／入力。&#10;または「✨ Geminiで生成」で自動作成（要APIキー）。">' + esc(cur || '') + '</textarea>' +
    '<div class="btnrow" style="margin-top:8px">' +
    '<button class="btn primary sm" data-act="explSave" data-num="' + q.num + '">💾 保存</button>' +
    '<button class="btn sm" data-act="explGen" data-num="' + q.num + '">✨ Geminiで生成</button>' +
    '<button class="btn ghost sm" data-act="explCancel">キャンセル</button>' +
    (ExplStore.get(deckId, q.num) ? '<button class="btn ghost sm danger" data-act="explClear" data-num="' + q.num + '">削除</button>' : '') +
    '</div>' +
    '<p class="small muted" style="margin:6px 0 0">保存先は端末内のみ。複数端末で使う/バックアップするなら「📊弱点 → 追記解説を書き出し」で <code class="k">_Gemini解説.md</code> に出力できます。</p>';
}
/* アプリで追記した解説を _Gemini解説.md 形式で書き出し */
function buildAddedExplMd(deckId) {
  var d = Store.getDeck(deckId), m = ExplStore.all(deckId);
  var nums = Object.keys(m).map(Number).sort(function (a, b) { return a - b; });
  var qByNum = {}; d.questions.forEach(function (q) { qByNum[q.num] = q; });
  var lines = ['# ' + d.name + ' Gemini解説まとめ（アプリ追記分）', '', '> ' + nums.length + ' 問ぶん（書き出し: ' + fmtDate(Date.now()) + '）', ''];
  nums.forEach(function (n) {
    var q = qByNum[n] || {};
    lines.push('## 問題 ' + n + '　' + (q.genre || ''));
    lines.push(''); lines.push(m[n]); lines.push(''); lines.push('---'); lines.push('');
  });
  return lines.join('\n');
}

/* ---------- 弱点（統計） ---------- */
function renderStatsDeck(deckId) {
  var d = Store.getDeck(deckId); if (!d) return show('stats');
  var backTo = ActiveDeck.deckId() === deckId ? 'home' : 'stats';
  var backLabel = ActiveDeck.deckId() === deckId ? '← ホーム' : '← 戻る';
  var at = Store.attempts(deckId);
  if (!at.length && PStats.count(deckId) === 0) {
    app.innerHTML = '<div class="card"><div class="row"><button class="btn ghost sm" data-act="back" data-to="' + backTo + '">' + backLabel + '</button>' +
      '<h3 class="grow" style="margin:0 0 0 8px">' + esc(deckLabel(d.name)) + '</h3></div>' +
      '<div class="empty">まだ記録がありません。<br>試験モードや練習モードをやると、ここに弱点が出ます。<br>' +
      '<button class="btn primary" data-act="startExam" data-id="' + esc(deckId) + '" style="margin-top:12px">📝 試験を始める</button></div></div>' +
      confCardHtml(deckId);
    return;
  }
  var gs = genreStats(deckId), qs = qStats(deckId);
  var best = 0, lastP = at.length ? pct(at[at.length - 1].correctCount, at[at.length - 1].total) : 0;
  at.forEach(function (a) { best = Math.max(best, pct(a.correctCount, a.total)); });
  // 正答率の推移（直近12回）
  var trend = at.slice(-12).map(function (a) { return pct(a.correctCount, a.total); });
  var tbars = trend.map(function (v) {
    var col = v >= 72 ? 'var(--ok)' : v >= 50 ? 'var(--warn)' : 'var(--bad)';
    return '<div class="tb" title="' + v + '%"><span>' + v + '</span><i style="height:' + Math.max(3, v) + '%;background:' + col + '"></i></div>';
  }).join('');
  var trendCard = trend.length >= 2
    ? '<div class="card"><h3>正答率の推移（直近' + trend.length + '回）</h3><div class="trend"><div class="passline"></div>' + tbars + '</div></div>'
    : '';

  // ジャンル別（低い順）
  var gkeys = Object.keys(gs).sort(function (x, y) { return (gs[x].correct / gs[x].seen) - (gs[y].correct / gs[y].seen); });
  var grows = '';
  gkeys.forEach(function (k) {
    var g = gs[k], gp = pct(g.correct, g.seen);
    var col = gp >= 72 ? 'var(--ok)' : gp >= 50 ? 'var(--warn)' : 'var(--bad)';
    var need = Math.max(0, Math.ceil(g.seen * 0.72) - g.correct);
    grows += '<tr><td>' + esc(g.name) + '</td><td class="rt">' + g.correct + '/' + g.seen + '</td>' +
      '<td style="width:34%"><div class="meter"><i style="width:' + gp + '%;background:' + col + '"></i></div></td><td class="rt">' + gp + '%</td>' +
      '<td class="rt">' + (need ? ('あと' + need + '問') : '達成') + '</td></tr>';
  });

  // よく間違える問題（正答率低い順）
  var miss = Object.keys(qs).map(function (n) {
    var s = qs[n]; return { num: parseInt(n, 10), seen: s.seen, correct: s.correct, rate: s.correct / s.seen };
  }).filter(function (x) { return x.rate < 1; }).sort(function (a, b) { return a.rate - b.rate || b.seen - a.seen; }).slice(0, 25);
  var qmap = {}; d.questions.forEach(function (q) { qmap[q.num] = q; });
  var mrows = '';
  miss.forEach(function (m) {
    var q = qmap[m.num] || {};
    mrows += '<button class="btn block" style="justify-content:space-between;margin:5px 0" data-act="reviewOne" data-id="' + esc(deckId) + '" data-num="' + m.num + '">' +
      '<span>Q' + m.num + ' <span class="small muted">' + esc(q.genre || '') + '</span></span>' +
      '<span class="small">正答 ' + m.correct + '/' + m.seen + ' →</span></button>';
  });

  // 受験履歴
  var hrows = '';
  at.slice().reverse().forEach(function (a) {
    hrows += '<tr><td>' + fmtDate(a.finishedAt) + '</td><td class="rt">' + pct(a.correctCount, a.total) + '%</td>' +
      '<td class="rt">' + a.correctCount + '/' + a.total + '</td><td class="rt">' + fmtDur(a.durationSec) + '</td></tr>';
  });

  app.innerHTML =
    '<div class="card"><div class="row"><button class="btn ghost sm" data-act="back" data-to="' + backTo + '">' + backLabel + '</button>' +
    '<h3 class="grow" style="margin:0 0 0 8px">' + esc(deckLabel(d.name)) + ' 弱点</h3></div>' +
    '<div class="kpi" style="margin-top:10px">' +
    '<div class="b"><b>' + at.length + '</b><span class="small muted">受験回数</span></div>' +
    '<div class="b"><b>' + lastP + '%</b><span class="small muted">直近</span></div>' +
    '<div class="b"><b>' + best + '%</b><span class="small muted">ベスト</span></div></div></div>' +
    trendCard +
    '<div class="card"><h3>ジャンル別 正答率（弱い順）</h3><p class="small muted">目標72%までに必要な追加正解数の目安も表示します。</p><table class="tbl"><tr><th>ジャンル</th><th class="rt">正答</th><th></th><th class="rt">率</th><th class="rt">72%まで</th></tr>' + grows + '</table></div>' +
    '<div class="card"><h3>よく間違える問題</h3>' + (mrows || '<div class="empty small">なし</div>') + '</div>' +
    '<div class="card"><h3>受験履歴</h3><table class="tbl"><tr><th>日時</th><th class="rt">率</th><th class="rt">正解</th><th class="rt">時間</th></tr>' + hrows + '</table></div>' +
    '<div class="card"><h3>🤖 弱点分析をAIに依頼</h3>' +
    '<p class="small muted">下のデータをコピーしてClaude等に貼ると、弱点分析・学習プランを作ってもらえます（問題文は含めず、ジャンル別成績とQ番号のみ）。</p>' +
    '<div class="btnrow"><button class="btn primary grow" data-act="copyWeak" data-id="' + esc(deckId) + '">📋 データをコピー</button>' +
    '<button class="btn grow" data-act="saveWeak" data-id="' + esc(deckId) + '">💾 .md保存</button></div></div>' +
    '<div class="card"><h3>✏️ 追記した解説</h3>' +
    '<p class="small muted">解説モードで追記/編集した解説：<b>' + ExplStore.count(deckId) + '問</b>。<code class="k">_Gemini解説.md</code>として書き出すと、他端末への引継ぎやバックアップに使えます。</p>' +
    '<button class="btn block" data-act="exportAddedExpl" data-id="' + esc(deckId) + '">📝 追記解説を書き出し（_Gemini解説.md）</button></div>' +
    confCardHtml(deckId);
}

/* ---------- 弱点エクスポート ---------- */
function buildWeaknessMd(deckId) {
  var d = Store.getDeck(deckId); var at = Store.attempts(deckId);
  var gs = genreStats(deckId), qs = qStats(deckId);
  var lines = [];
  lines.push('# SAA模試 学習データ（弱点分析依頼用）');
  lines.push('');
  lines.push('- デッキ: ' + d.name + '（全' + d.count + '問）');
  lines.push('- 集計日時: ' + fmtDate(Date.now()));
  var best = 0; at.forEach(function (a) { best = Math.max(best, pct(a.correctCount, a.total)); });
  lines.push('- 受験回数: ' + at.length + ' ／ 直近正答率: ' + (at.length ? pct(at[at.length - 1].correctCount, at[at.length - 1].total) : 0) + '% ／ ベスト: ' + best + '%');
  lines.push('- 合格ライン: 72%');
  lines.push('');
  lines.push('## ジャンル別 正答率（低い順）');
  lines.push('| ジャンル | 正答率 | 正解/出題 |');
  lines.push('|---|---|---|');
  Object.keys(gs).sort(function (x, y) { return (gs[x].correct / gs[x].seen) - (gs[y].correct / gs[y].seen); })
    .forEach(function (k) { var g = gs[k]; lines.push('| ' + g.name + ' | ' + pct(g.correct, g.seen) + '% | ' + g.correct + '/' + g.seen + ' |'); });
  lines.push('');
  lines.push('## よく間違える問題（正答率低い順・最大30）');
  var qmap = {}; d.questions.forEach(function (q) { qmap[q.num] = q; });
  var miss = Object.keys(qs).map(function (n) { var s = qs[n]; return { num: +n, seen: s.seen, correct: s.correct, rate: s.correct / s.seen }; })
    .filter(function (x) { return x.rate < 1; }).sort(function (a, b) { return a.rate - b.rate || b.seen - a.seen; }).slice(0, 30);
  miss.forEach(function (m) {
    var q = qmap[m.num] || {};
    lines.push('- Q' + m.num + ' [' + (q.genre || '?') + '] 正答' + m.correct + '/' + m.seen + ' ｜ 正解テーマ: ' + (q.correctTheme || ''));
  });
  if (!miss.length) lines.push('- （なし）');
  lines.push('');
  lines.push('## 受験履歴');
  lines.push('| 日時 | 正答率 | 正解/問 | 時間 |');
  lines.push('|---|---|---|---|');
  at.slice().reverse().forEach(function (a) {
    lines.push('| ' + fmtDate(a.finishedAt) + ' | ' + pct(a.correctCount, a.total) + '% | ' + a.correctCount + '/' + a.total + ' | ' + fmtDur(a.durationSec) + ' |');
  });
  lines.push('');
  lines.push('> このデータを見て、根深い弱点・優先して復習すべきジャンル・次の学習プランを分析してください。');
  return lines.join('\n');
}
/* 自信度・メモ → 教師プロンプト用テキスト（思い込みトリアージ付き） */
function buildTutorMemoMd(deckId) {
  var d = Store.getDeck(deckId) || { name: '', questions: [] };
  var cm = CONF.all(deckId);
  var qByNum = {}; d.questions.forEach(function (q) { qByNum[q.num] = q; });
  var lastA = lastAnswerMap(deckId);
  function verdict(n) {
    var q = qByNum[n] || {};
    if (q.srcVerdict) return q.srcVerdict;          // 本番(模試CSV)優先
    if (lastA[n]) return lastA[n].isCorrect ? '○' : '×'; // なければアプリ内受験
    return '';
  }
  var nums = Object.keys(cm).map(Number).sort(function (a, b) { return a - b; });
  function line(n) {
    var q = qByNum[n] || {};
    return '- Q' + n + '（自信' + (cm[n].c || '?') + '・' + (q.genre || '?') + '）正解テーマ: ' + (q.correctTheme || '') +
      (cm[n].m ? ' ｜メモ: ' + cm[n].m : '');
  }
  var omoi = [], magu = [], mada = [];
  nums.forEach(function (n) {
    var c = cm[n].c || '', v = verdict(n);
    if (v === '×' && (c === '◎' || c === '○')) omoi.push(n);
    else if (v === '○' && (c === '×' || c === '△')) magu.push(n);
    else if (v === '×') mada.push(n);
  });
  var L = ['# ' + d.name + ' 自信度・思ったことメモ（教師プロンプト用）', '',
    '> 書き出し ' + fmtDate(Date.now()) + '／記録 ' + nums.length + '問。自信度 ◎=確信 ○=たぶん △=勘 ×=わからない。正誤は本番(模試CSV)優先。', '',
    '## 🚨 最優先：思い込み（◎○なのに不正解）' + omoi.length + '問'];
  L = L.concat(omoi.length ? omoi.map(line) : ['- （なし）']);
  L.push('', '## ⚠️ まぐれ（×/△なのに正解＝実力外）' + magu.length + '問');
  L = L.concat(magu.length ? magu.map(line) : ['- （なし）']);
  L.push('', '## 未学習（△×で不正解）' + mada.length + '問');
  L = L.concat(mada.length ? mada.map(line) : ['- （なし）']);
  L.push('', '## 全記録', '| Q | 正誤 | 自信度 | ジャンル | メモ |', '|---|---|---|---|---|');
  nums.forEach(function (n) {
    var q = qByNum[n] || {};
    L.push('| Q' + n + ' | ' + (verdict(n) || '-') + ' | ' + (cm[n].c || '-') + ' | ' + (q.genre || '') + ' | ' + (cm[n].m || '').replace(/\|/g, '/') + ' |');
  });
  L.push('', '> ◎○で外した問題を最優先で再出題し、「なぜそう思ったか→正しい型」を言語化させてください。');
  return L.join('\n');
}
/* 「番号 自信度 メモ」形式テキストを取り込む（手書きtxt / アプリ書き出し両対応） */
function importConfText(deckId, text) {
  var n = 0;
  String(text || '').split(/\r?\n/).forEach(function (ln) {
    var m = ln.match(/^\s*(\d{1,3})[\s.:、，]+([◎○〇△×✕xXｘ])\s*(.*)$/);
    if (!m) return;
    CONF.setConf(deckId, parseInt(m[1], 10), normConf(m[2]));
    var memo = (m[3] || '').trim();
    if (memo) CONF.setMemo(deckId, parseInt(m[1], 10), memo);
    n++;
  });
  return n;
}
/* 自信度・メモ カード（弱点画面で受験履歴の有無に関わらず表示） */
function confCardHtml(deckId) {
  return '<div class="card"><h3>🎓 自信度・メモ（教師プロンプト用）</h3>' +
    '<p class="small muted">各問の自信度（◎○△×）＋メモ＋本番(模試)の正誤を書き出し。<b>◎○なのに不正解＝思い込み</b>を最優先表示。家庭教師プロンプトに貼れます。記録: <b>' + CONF.count(deckId) + '問</b></p>' +
    '<div class="btnrow"><button class="btn primary grow" data-act="confExportCopy" data-id="' + esc(deckId) + '">📋 コピー</button>' +
    '<button class="btn grow" data-act="confExportSave" data-id="' + esc(deckId) + '">💾 保存(_自信度メモ.md)</button></div>' +
    '<details class="moredetail" style="margin-top:10px"><summary>📥 自信度メモを貼り付けて取込</summary>' +
    '<div style="padding:0 12px 12px"><p class="small muted">1行に「番号 自信度(◎○△×) メモ」。例 <code class="k">20 △ ACは違う</code></p>' +
    '<textarea id="confImportTA" class="expl-edit" style="min-height:120px" placeholder="1 ○&#10;20 △ ACは違うと思う&#10;43 × 運"></textarea>' +
    '<button class="btn primary block sm" data-act="confImport" data-id="' + esc(deckId) + '" style="margin-top:8px">取込む</button></div></details></div>';
}
function saveTextFile(filename, text) {
  var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { toast('コピーしました'); }, function () { fallbackCopy(text); });
  }
  fallbackCopy(text);
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { toast('コピー不可。.md保存をご利用ください'); }
  ta.remove();
}

/* ============================ イベント ============================ */
var handlers = {
  goImport: function () { show('import'); },
  home: function () { show('home'); },
  openSchedule: function () { show('schedule'); },
  back: function (t) { show(t.dataset.to); },
  gloss: function (t) { showGloss(t.dataset.term); },
  glossClose: function () { var s = document.getElementById('glossSheet'); if (s) s.remove(); },
  // 練習モード
  startPractice: function (t) { show('practiceSetup', t.dataset.id); },
  beginPractice: function () { beginPractice(); },
  pPick: function (t) { pPick(parseInt(t.dataset.n, 10)); },
  pReveal: function () { pReveal(); },
  pNext: function () { pNext(); },
  pBm: function (t) { var p = state.practice; BM.toggle(p.deckId, parseInt(t.dataset.num, 10)); renderPracticeRun(); },
  pQuit: function () { if (confirm('練習をやめますか？（成績は弱点分析に反映済み）')) { state.practice = null; show('practice'); } },
  practiceAgain: function (t) { show('practiceSetup', t.dataset.id); },
  startExam: function (t) { show('examSetup', t.dataset.id); },
  beginExam: function () { beginExam(); },
  openReview: function (t) { show('reviewRun', { deckId: t.dataset.id }); },
  openStats: function (t) { show('statsDeck', t.dataset.id); },
  delDeck: function (t) {
    var d = Store.getDeck(t.dataset.id);
    if (d && confirm('「' + d.name + '」と その受験記録を削除しますか？')) { Store.delDeck(t.dataset.id); show('home'); }
  },
  // 中断試験の再開／破棄
  resumeExam: function () { var ex = loadActiveExam(); if (!ex) { show('home'); return; } if (!ex.revealed) ex.revealed = {}; state.exam = ex; show('examRun'); },
  discardExam: function () { if (confirm('中断中の試験を破棄しますか？')) { clearActiveExam(); show('home'); } },
  // 設定・バックアップ
  setFont: function (t) { var s = Settings.get(); s.font = parseInt(t.dataset.f, 10); Settings.set(s); Settings.applyFont(); renderHome(); },
  backup: function () { saveTextFile('SAA模試_バックアップ_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json', exportAllData()); toast('バックアップを書き出しました'); },
  restore: function () { var f = $('#restoreFile'); if (f) f.click(); },
  // exam run
  pick: function (t) { pickChoice(parseInt(t.dataset.n, 10)); },
  reveal: function () { revealAnswer(); },
  bmEx: function () { var ex = state.exam, q = ex.qs[ex.idx]; BM.toggle(qDeckId(q), q.num); renderExamRun(); },
  flag: function () { var ex = state.exam, q = ex.qs[ex.idx]; ex.flags[q.num] = !ex.flags[q.num]; renderExamRun(); },
  nextQ: function () { if (state.exam.idx < state.exam.qs.length - 1) { state.exam.idx++; renderExamRun(); } },
  prevQ: function () { if (state.exam.idx > 0) { state.exam.idx--; renderExamRun(); } },
  jump: function (t) { state.exam.idx = parseInt(t.dataset.i, 10); renderExamRun(); },
  finishExam: function () { finishExam(); },
  quitExam: function () { if (confirm('試験を中断します。\n「OK」で中断（あとでホームから再開できます）')) { if (_timer) clearInterval(_timer); saveActiveExam(); state.exam = null; show('exam'); } },
  // result
  bmRes: function (t) { BM.toggle(state.lastAttempt.deckId, parseInt(t.dataset.num, 10)); show('examResult', state.lastAttempt); },
  retrySame: function () {
    var qsv = state.lastExamQs; if (!qsv || !qsv.length) { show('home'); return; }
    var su = state.lastSetup || {}, d = Store.getDeck(su.deckId) || {};
    state.exam = { deckId: su.deckId, deckName: d.name || '', qs: qsv.slice(), idx: 0, answers: {}, flags: {}, startedAt: Date.now(), study: !!su.study, revealed: {} };
    saveActiveExam(); show('examRun');
  },
  retryWrong: function () {
    var a = state.lastAttempt; if (!a) return;
    var qmap = {}; (state.lastExamQs || []).forEach(function (q) { qmap[q.num] = q; });
    var qsv = a.items.filter(function (it) { return !it.isCorrect; }).map(function (it) { return qmap[it.num]; }).filter(Boolean);
    if (!qsv.length) { toast('対象がありません'); return; }
    var d = Store.getDeck(a.deckId) || {};
    state.exam = { deckId: a.deckId, deckName: d.name || '', qs: qsv, idx: 0, answers: {}, flags: {}, startedAt: Date.now(), study: true, revealed: {} };
    saveActiveExam(); show('examRun');
  },
  // review
  reviewOne: function (t) { show('reviewRun', { deckId: t.dataset.id, num: parseInt(t.dataset.num, 10) }); },
  rvBm: function (t) { var r = state.review; r.editing = false; BM.toggle(r.deckId, parseInt(t.dataset.num, 10)); show('reviewRun', { deckId: r.deckId }); },
  rvFilter: function (t) { var r = state.review; r.editing = false; r.filter = t.dataset.f; r.idx = 0; show('reviewRun', { deckId: r.deckId }); },
  rvGenre: function (t) { var r = state.review; r.editing = false; r.filter = 'genre'; r.genre = t.dataset.g; r.idx = 0; show('reviewRun', { deckId: r.deckId }); },
  rvPrev: function () { var r = state.review; r.editing = false; if (r.idx > 0) { r.idx--; show('reviewRun', { deckId: r.deckId }); } },
  rvNext: function () { var r = state.review; r.editing = false; if (r.idx < state.reviewList.length - 1) { r.idx++; show('reviewRun', { deckId: r.deckId }); } },
  // 解説の追記・編集（アプリ内）
  explEdit: function () { state.review.editing = true; show('reviewRun', { deckId: state.review.deckId }); },
  explCancel: function () { state.review.editing = false; show('reviewRun', { deckId: state.review.deckId }); },
  explSave: function (t) {
    var ta = $('#explTA'); if (!ta) return;
    ExplStore.set(state.review.deckId, parseInt(t.dataset.num, 10), ta.value);
    state.review.editing = false; toast('解説を保存しました'); show('reviewRun', { deckId: state.review.deckId });
  },
  explClear: function (t) {
    if (!confirm('この問題の追記解説を削除しますか？')) return;
    ExplStore.set(state.review.deckId, parseInt(t.dataset.num, 10), '');
    state.review.editing = false; show('reviewRun', { deckId: state.review.deckId });
  },
  explGen: function (t) {
    var deckId = state.review.deckId, num = parseInt(t.dataset.num, 10);
    var d = Store.getDeck(deckId); var q = d.questions.find(function (x) { return x.num === num; });
    var key = ensureGeminiKey(); if (!key) { toast('APIキーが未設定です'); return; }
    var ta = $('#explTA'); if (ta) { ta.value = '✨ Geminiが生成中…しばらくお待ちください'; ta.disabled = true; }
    callGemini(buildGeminiPrompt(q), key).then(function (text) {
      var ta2 = $('#explTA'); if (ta2) { ta2.disabled = false; ta2.value = text || '（空の応答）'; }
      toast('生成しました。内容を確認して「💾保存」を押してください');
    }).catch(function (e) {
      var ta2 = $('#explTA'); if (ta2) { ta2.disabled = false; ta2.value = ''; }
      toast('生成失敗: ' + (e.message || e));
    });
  },
  // weakness export
  copyWeak: function (t) { copyText(buildWeaknessMd(t.dataset.id)); },
  saveWeak: function (t) { var d = Store.getDeck(t.dataset.id); saveTextFile(d.name + '_学習データ.md', buildWeaknessMd(t.dataset.id)); toast('保存しました'); },
  exportAddedExpl: function (t) {
    var id = t.dataset.id; if (ExplStore.count(id) === 0) { toast('追記した解説がありません'); return; }
    var d = Store.getDeck(id); saveTextFile(d.name + '_Gemini解説_追記.md', buildAddedExplMd(id)); toast('書き出しました');
  },
  // 自信度＋メモ
  confSet: function (t) {
    var num = parseInt(t.dataset.num, 10), c = t.dataset.c;
    var inExam = state.view === 'examRun';
    var deckId;
    if (inExam) { var cq = state.exam.qs[state.exam.idx]; deckId = qDeckId(cq); }
    else deckId = state.review && state.review.deckId;
    if (!deckId) return;
    var ta = document.getElementById('confMemo-' + num); // 再描画前にメモを退避保存
    if (ta) CONF.setMemo(deckId, num, ta.value);
    CONF.setConf(deckId, num, c);
    if (inExam) renderExamRun();
    else { state.review.editing = false; show('reviewRun', { deckId: deckId }); }
  },
  confExportCopy: function (t) { copyText(buildTutorMemoMd(t.dataset.id)); },
  confExportSave: function (t) { var d = Store.getDeck(t.dataset.id); saveTextFile(d.name + '_自信度メモ.md', buildTutorMemoMd(t.dataset.id)); toast('保存しました'); },
  confImport: function (t) {
    var ta = $('#confImportTA'); if (!ta) return;
    var n = importConfText(t.dataset.id, ta.value);
    toast(n ? (n + '問の自信度を取込みました') : '形式に合う行がありません');
    show('statsDeck', t.dataset.id);
  },
  // サーバー（ログイン・同期）／今日の宿題
  doLogin: function () {
    var pw = $('#loginPw'); if (!pw) return; var msg = $('#loginMsg'); if (msg) msg.textContent = '確認中…';
    API.login(pw.value).then(function () { return Sync.pullInto(); })
      .then(function () { Sync.flushOutbox(); toast('ログインしました'); show('home'); })
      .catch(function (e) { if (msg) msg.textContent = (e && e.code === 401) ? 'パスワードが違います' : '接続できません'; });
  },
  logout: function () { if (!confirm('ログアウトしますか？')) return; API.setToken(''); show('login'); },
  syncNow: function () {
    if (!Sync.online()) { toast('サーバー未接続です'); return; }
    toast('同期中…'); Sync.flushOutbox().then(function () { return Sync.pullInto(); })
      .then(function () { toast('同期しました'); show('home'); }).catch(function () { toast('同期に失敗しました'); });
  },
  startHw: function () {
    if (!Sync.online()) { toast('サーバーに接続してください（ログイン）'); return; }
    toast('今日の宿題を準備中…');
    API.homework(HW_N, ActiveDeck.deckId()).then(function (hw) {
      if (!hw.items || !hw.items.length) { toast('対象なし。まず模試CSVを取込/受験してください'); return; }
      state.lastHw = hw; show('homework');
    }).catch(function () { toast('宿題の取得に失敗しました'); });
  },
  hwAll: function () {
    var hw = state.lastHw; if (!hw) return;
    var today = ymdLocal(new Date());
    var todo = (hw.items || []).filter(function (it) { var s = SRS.get(it.deckId, it.num); return !(s && s.lastDay === today); });
    if (!todo.length) { toast('今日の宿題は完了です'); return; }
    startHomeworkSession(hw, todo);
  },
  hwItem: function (t) {
    var hw = state.lastHw; if (!hw) return;
    var it = (hw.items || [])[parseInt(t.dataset.i, 10)];
    if (it) startHomeworkSession(hw, [it]);
  },
  hwReview: function () {
    var p = reviewPool(ActiveDeck.deckId()).filter(function (x) { return !x.mastered && !x.doneToday; });
    p.sort(function (a, b) { return (a.omoi ? 0 : 1) - (b.omoi ? 0 : 1) || a.box - b.box; });
    var todo = p.slice(0, 20);
    if (!todo.length) { toast('今日の見直しは完了！'); return; }
    startReviewSession(todo);
  },
  hwTutorCopy: function () { copyText(buildTodayTutorPrompt(state.lastHw || { items: [] })); },
  hwPrint: function () { printHomework(); },
  quickFocus: function (t) { startQuickFocus(parseInt(t.dataset.n, 10) || 5); },
  startFlash: function () { startFlash(); },
  flashReveal: function () { flashReveal(); },
  flashGood: function () { flashAdvance(true); },
  flashBad: function () { flashAdvance(false); },
  flashNext: function () { flashAdvance(null); },
  flashRestart: function () { startFlash(); },
  flashTts: function () { Speech.setOn(!Speech.on()); renderFlash(); },
  flashSpeak: function () { var c = flashCur(); if (c) Speech.speak(state.flash.revealed ? ttsAnswerText(c.q) : ttsQuestionText(c.q)); }
};
function doRestore(fileList) {
  var f = (fileList || [])[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function () {
    try {
      if (!confirm('現在のデータに上書き復元します。よろしいですか？')) return;
      var n = importAllData(String(rd.result));
      toast(n + ' 件を復元しました'); Settings.applyFont(); show('home');
    } catch (e) { toast('復元失敗: ' + (e.message || 'JSON不正')); }
  };
  rd.readAsText(f, 'utf-8');
}
app.addEventListener('click', function (e) {
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.dataset.act;
  if (handlers[act]) { e.preventDefault(); handlers[act](t, e); }
});
document.getElementById('tabbar').addEventListener('click', function (e) {
  var b = e.target.closest('[data-nav]'); if (!b) return;
  if (state.exam && b.getAttribute('data-nav') !== 'exam') {
    if (!confirm('試験を一時中断して移動しますか？（あとでホームから再開できます）')) return;
    if (_timer) clearInterval(_timer); saveActiveExam(); state.exam = null;
  }
  show(b.getAttribute('data-nav'));
});

/* ---------- キーボード操作（PC） ---------- */
document.addEventListener('keydown', function (e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
  if (state.view === 'examRun' && state.exam) {
    var ex = state.exam, q = ex.qs[ex.idx];
    if (/^[1-9]$/.test(e.key)) {
      var p = parseInt(e.key, 10);
      var n = (ex.shuffleCh && ex.perm[q.num]) ? ex.perm[q.num][p - 1] : p;
      if (n && n <= q.choices.length && !(ex.study && ex.revealed[q.num])) { pickChoice(n); e.preventDefault(); }
    } else if (e.key === 'ArrowLeft') { if (ex.idx > 0) { ex.idx--; renderExamRun(); } e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (ex.study && !ex.revealed[q.num]) { revealAnswer(); }
      else if (ex.idx < ex.qs.length - 1) { ex.idx++; renderExamRun(); }
      else { var fb = app.querySelector('[data-act="finishExam"]'); if (fb) fb.click(); }   // 最終問題はEnterで採点/結果へ
      e.preventDefault();
    }
  } else if (state.view === 'reviewRun' && state.review) {
    if (e.key === 'ArrowLeft') { if (state.review.idx > 0) { state.review.idx--; show('reviewRun', { deckId: state.review.deckId }); } }
    else if (e.key === 'ArrowRight') { if (state.review.idx < (state.reviewList || []).length - 1) { state.review.idx++; show('reviewRun', { deckId: state.review.deckId }); } }
  } else if (state.view === 'flash' && state.flash) {
    // ながら復習：未公開はEnter/Space/→で答え表示、公開後は1=わかった/2=あやしい/Enter等で次へ
    var clickFlash = function (act) { var b = app.querySelector('[data-act="' + act + '"]'); if (b) { b.click(); return true; } return false; };
    if (!state.flash.revealed) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { clickFlash('flashReveal'); e.preventDefault(); }
    } else {
      if (e.key === '1') { clickFlash('flashGood'); e.preventDefault(); }
      else if (e.key === '2') { clickFlash('flashBad'); e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { clickFlash('flashNext'); e.preventDefault(); }
    }
  }
});

/* ---------- スワイプ操作（スマホ：左右で前後の問題へ） ---------- */
(function () {
  var x0 = null, y0 = null;
  app.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  app.addEventListener('touchend', function (e) {
    if (x0 == null) return;
    var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 横スワイプのみ
    if (e.target.closest('.expl, .moredetail, input, textarea, select')) return; // スクロール領域は無視
    var fwd = dx < 0;
    if (state.view === 'examRun' && state.exam) {
      var ex = state.exam, q = ex.qs[ex.idx];
      if (fwd) {
        if (ex.study && !ex.revealed[q.num]) { revealAnswer(); }
        else if (ex.idx < ex.qs.length - 1) { ex.idx++; renderExamRun(); }
      } else if (ex.idx > 0) { ex.idx--; renderExamRun(); }
    } else if (state.view === 'reviewRun' && state.review) {
      if (fwd) { if (state.review.idx < (state.reviewList || []).length - 1) { state.review.idx++; show('reviewRun', { deckId: state.review.deckId }); } }
      else if (state.review.idx > 0) { state.review.idx--; show('reviewRun', { deckId: state.review.deckId }); }
    } else if (state.view === 'flash' && state.flash) {
      if (fwd) { if (!state.flash.revealed) flashReveal(); else flashAdvance(null); }   // 左スワイプ＝めくる→次へ
    }
  }, { passive: true });
})();

/* ---------- PWA: SW登録 & 更新通知 ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return; refreshing = true; location.reload();
  });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
      reg.update();  // 起動ごとに更新チェック
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(nw);
        });
      });
    }).catch(function () {});
  });
}
function showUpdateBanner(worker) {
  if (document.getElementById('updBanner')) return;
  var b = document.createElement('button');
  b.id = 'updBanner'; b.className = 'updbanner';
  b.textContent = '🔄 新しいバージョンがあります（タップで更新）';
  b.onclick = function () { b.disabled = true; worker.postMessage({ type: 'SKIP_WAITING' }); };
  document.body.appendChild(b);
}
var deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault(); deferredPrompt = e;
  var b = document.getElementById('installBtn'); b.style.display = 'inline-block';
  b.onclick = function () { b.style.display = 'none'; deferredPrompt.prompt(); deferredPrompt = null; };
});

/* ---------- 起動 ---------- */
Settings.applyFont();
initDeckChip();
Sync.boot();   // サーバーに繋がればログイン/同期、無ければ従来どおりローカル動作

})();
