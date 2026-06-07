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
  },
  delDeck: function (id) {
    LS.del('saa.deck.' + id); LS.del('saa.attempts.' + id);
    LS.set('saa.deckIndex', this.deckIds().filter(function (x) { return x !== id; }));
  },
  decks: function () { return this.deckIds().map(function (id) { return Store.getDeck(id); }).filter(Boolean); },
  attempts: function (id) { return LS.get('saa.attempts.' + id, []); },
  addAttempt: function (id, a) { var arr = this.attempts(id); a.id = Date.now(); arr.push(a); LS.set('saa.attempts.' + id, arr); return a; }
};

/* ---------- ブックマーク（★） ---------- */
var BM = {
  list: function (deckId) { return LS.get('saa.bm.' + deckId, []); },
  has: function (deckId, num) { return BM.list(deckId).indexOf(num) >= 0; },
  toggle: function (deckId, num) {
    var a = BM.list(deckId), i = a.indexOf(num);
    if (i >= 0) a.splice(i, 1); else a.push(num);
    LS.set('saa.bm.' + deckId, a); return i < 0;
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
  return fname.replace(/\.(csv|md)$/i, '')
    .replace(/_問題集.*$/, '').replace(/_章別チェックリスト.*$/, '')
    .replace(/_Gemini解説.*$/i, '').replace(/_学習データ.*$/, '')
    .replace(/_チェック済$/, '').trim() || 'デッキ';
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
function qStats(deckId) {
  var at = Store.attempts(deckId), m = {};
  at.forEach(function (a) {
    a.items.forEach(function (it) {
      var s = m[it.num] || (m[it.num] = { seen: 0, correct: 0, last: null });
      s.seen++; if (it.isCorrect) s.correct++; s.last = it.isCorrect;
    });
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
/* 解説ブロック: Gemini解説を主、CSV解説を「詳しい解説」に */
function explBlock(q) {
  if (q.gemini) {
    var h = '<div class="q-section-label small muted" style="margin-top:12px">解説 <span class="tag">Gemini</span></div>' +
      '<div class="expl">' + mdToHtml(q.gemini) + '</div>';
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
function show(view, arg) {
  state.view = view;
  if (['home', 'import', 'exam', 'review', 'stats'].indexOf(view) >= 0) setNav(view);
  window.scrollTo(0, 0);
  if (view === 'home') return renderHome();
  if (view === 'import') return renderImport();
  if (view === 'exam') return renderExamHub();
  if (view === 'review') return renderReviewHub();
  if (view === 'stats') return renderStatsHub();
  if (view === 'examSetup') return renderExamSetup(arg);
  if (view === 'examRun') return renderExamRun();
  if (view === 'examResult') return renderExamResult(arg);
  if (view === 'reviewRun') return renderReviewRun(arg);
  if (view === 'statsDeck') return renderStatsDeck(arg);
}

/* ---------- ホーム ---------- */
function renderHome() {
  var decks = Store.decks();
  var html = '';
  // 中断した試験の再開バナー
  var ae = loadActiveExam();
  if (ae) {
    var doneA = Object.keys(ae.answers || {}).filter(function (k) { return ae.answers[k] && ae.answers[k].length; }).length;
    html += '<div class="card" style="border-color:var(--warn)">' +
      '<div class="row"><div class="grow"><b>⏸ 中断中の試験があります</b>' +
      '<div class="small muted">' + esc(ae.deckName) + '：' + ae.qs.length + '問中 ' + doneA + '問 回答済</div></div></div>' +
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
      html += '<div class="card">' +
        '<div class="row"><div class="grow"><b style="font-size:17px">' + esc(d.name) + '</b>' +
        (d.hasChecklist ? ' <span class="tag">章分類済</span>' : '') +
        (d.hasGemini ? ' <span class="tag">Gemini解説</span>' : '') +
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
  var rf = $('#restoreFile');
  if (rf) rf.addEventListener('change', function () { doRestore(rf.files); });
}

/* ---------- 取込 ---------- */
function renderImport() {
  app.innerHTML =
    '<div class="card"><h3>📥 問題を取り込む</h3>' +
    '<p class="small muted">ファイルを選ぶ／ここにドラッグ＆ドロップ。問題は端末内のみに保存されます。</p>' +
    '<div class="drop" id="drop">' +
    '<div style="font-size:34px">🗂️</div><div>タップしてファイルを選択<br><span class="small muted">または ここにドロップ</span></div>' +
    '<input type="file" id="file" accept=".csv,.md" multiple style="display:none" /></div>' +
    '<div class="spacer"></div>' +
    '<p class="small muted">対応ファイル：<br>① <code class="k">○○_問題集.csv</code>（必須／問題・選択肢・正解・解説）<br>' +
    '② <code class="k">○○_章別チェックリスト.csv</code>（任意／ジャンル分類を精密化）<br>' +
    '③ <code class="k">○○_Gemini解説.md</code>（任意／Gemini解説を「解説」に表示。原文は「詳しい解説」に）<br>' +
    '同じ模試の①②③をまとめて選ぶと自動で1デッキに統合します。</p>' +
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
    if (/Gemini解説/.test(f.name) || /\.md$/i.test(f.name)) return 2;
    if (/チェックリスト/.test(f.name)) return 1;
    return 0;
  }
  files.sort(function (a, b) { return rank(a) - rank(b); });
  var pending = files.length, log = [];
  files.forEach(function (f) {
    var rd = new FileReader();
    rd.onload = function () {
      try { log.push(importOne(f.name, String(rd.result))); }
      catch (e) { log.push('⚠ ' + f.name + '：' + (e.message || '読み込み失敗')); }
      if (--pending === 0) { toast(log.join(' / ')); show('home'); }
    };
    rd.onerror = function () { log.push('⚠ ' + f.name + '：読込エラー'); if (--pending === 0) { toast(log.join(' / ')); show('home'); } };
    rd.readAsText(f, 'utf-8');
  });
}
function importOne(fname, text) {
  var name = deckNameFromFile(fname);
  // Gemini解説md
  if (/\.md$/i.test(fname) || /Gemini解説/.test(fname)) {
    var dg = Store.getDeck(name);
    if (!dg) throw new Error('先に「' + name + '_問題集.csv」を取り込んでください');
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
    h += '<button class="btn block" style="justify-content:space-between;margin:6px 0" data-act="' + act + '" data-id="' + esc(d.id) + '">' +
      '<span>' + esc(d.name) + '</span><span class="small muted">' + d.count + '問</span></button>';
  });
  return h + '</div>';
}
function renderExamHub() {
  var decks = Store.decks();
  if (!decks.length) { app.innerHTML = pickDeckCard('📝 試験モード', 'startExam'); return; }
  var last = LS.get('saa.lastDeck', null);
  var id = (last && Store.getDeck(last)) ? last : decks[0].id;
  renderExamSetup(id);
}
function renderReviewHub() { app.innerHTML = pickDeckCard('📖 解説モード', 'openReview'); }
function renderStatsHub() { app.innerHTML = pickDeckCard('📊 弱点分析', 'openStats'); }

/* ---------- 試験セットアップ（模試選択・章絞り・低正答率絞り・問題数 を組合せ可） ---------- */
function renderExamSetup(deckId) {
  var decks = Store.decks();
  if (!decks.length) { app.innerHTML = pickDeckCard('📝 試験モード', 'startExam'); return; }
  if (!deckId || !Store.getDeck(deckId)) deckId = decks[0].id;
  var d = Store.getDeck(deckId);
  state.setupDeck = deckId;
  var genres = deckGenres(d);
  var deckOpts = decks.map(function (x) {
    return '<option value="' + esc(x.id) + '"' + (x.id === deckId ? ' selected' : '') + '>' + esc(x.name) + '（' + x.count + '問）</option>';
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

  app.innerHTML =
    '<div class="card" style="margin-top:6px">' +
    '<div class="qmeta"><span>問題 ' + (ex.idx + 1) + ' / ' + total + ' ・ 回答済 ' + answered + (ex.study ? ' ・ 📖学習' : '') + '</span>' +
    '<span id="timer">⏱ 0:00</span></div>' +
    '<div class="bar"><i style="width:' + pct(ex.idx + 1, total) + '%"></i></div>' +
    '<div class="row wrap" style="margin-top:10px;gap:6px">' +
    '<span class="pill g">' + esc(q.genre) + '</span>' +
    '<span class="pill' + (q.importance === '高' ? ' hi' : '') + '">重要度 ' + esc(q.importance) + '</span>' +
    (multi ? '<span class="pill">複数選択可</span>' : '') +
    '<span class="grow"></span>' +
    '<button class="btn ghost sm" data-act="bmEx">' + (BM.has(ex.deckId, q.num) ? '★' : '☆') + '</button>' +
    '<button class="btn ghost sm" data-act="flag">' + (ex.flags[q.num] ? '🚩' : '🏳') + '</button>' +
    '</div>' +
    '<div class="qtext">' + esc(q.text) + '</div>' +
    ch +
    (revealed ? explBlock(q) : '') +
    '</div>' +
    '<div class="card"><div class="navgrid">' + navGridHtml() + '</div></div>' +
    '<div class="sticky-bottom">' + bottom + '</div>' +
    '<div class="spacer"></div>' +
    '<button class="btn ghost block danger sm" data-act="quitExam">試験を中断</button>';
  startTimer();
  saveActiveExam();
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
  renderExamRun();
}
function finishExam() {
  var ex = state.exam;
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
      '<summary>Q' + it.num + ' <span class="small muted">' + esc(it.genre) + '</span></summary>' +
      '<div style="padding:0 12px 12px">' +
      (q ? ('<div class="qtext" style="font-size:14px">' + esc(q.text) + '</div>' + choicesView(q, it.selected) + explBlock(q) +
        '<div style="margin-top:10px"><button class="btn sm" data-act="bmRes" data-num="' + it.num + '">' + (BM.has(a.deckId, it.num) ? '★ ブックマーク済' : '☆ ブックマーク') + '</button></div>')
        : '<span class="muted small">問題データなし</span>') +
      '</div></details>';
  });

  app.innerHTML =
    '<div class="card" style="text-align:center">' +
    '<div class="small muted">' + esc(a.deckName) + ' ・ ' + fmtDate(a.finishedAt) + '</div>' +
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
    app.innerHTML = '<div class="card"><div class="row"><button class="btn ghost sm" data-act="back" data-to="review">← デッキ</button>' +
      '<span class="grow"></span><span class="small muted">' + esc(d.name) + '</span></div>' +
      reviewToolbar(rv, d) + '<div class="empty">該当する問題がありません</div></div>';
    bindReviewToolbar();
    return;
  }
  if (rv.idx >= list.length) rv.idx = 0;
  var q = list[rv.idx];
  var st = qs[q.num];
  var mine = lastA[q.num];

  app.innerHTML =
    '<div class="card" style="margin-top:6px">' +
    '<div class="row"><button class="btn ghost sm" data-act="back" data-to="review">← デッキ</button>' +
    '<span class="grow"></span><span class="small muted">' + esc(d.name) + '</span></div>' +
    reviewToolbar(rv, d) + '</div>' +
    '<div class="card">' +
    '<div class="qmeta"><span>' + (rv.idx + 1) + ' / ' + list.length + '（Q' + q.num + '）</span>' +
    '<span>' + (st ? '正答 ' + st.correct + '/' + st.seen : '未受験') + '</span></div>' +
    '<div class="row wrap" style="gap:6px;margin:4px 0 8px">' +
    '<span class="pill g">' + esc(q.genre) + '</span>' +
    '<span class="pill' + (q.importance === '高' ? ' hi' : '') + '">重要度 ' + esc(q.importance) + '</span>' +
    '<span class="grow"></span>' +
    '<button class="btn ghost sm" data-act="rvBm" data-num="' + q.num + '">' + (BM.has(deckId, q.num) ? '★ 登録済' : '☆ ブックマーク') + '</button>' +
    '</div>' +
    '<div class="qtext">' + esc(q.text) + '</div>' +
    choicesView(q, mine ? mine.selected : []) +
    (mine ? '<div class="small ' + (mine.isCorrect ? 'okc' : 'ngc') + '" style="margin-top:6px">前回のあなた: ' + (mine.isCorrect ? '正解 ✓' : '不正解 ✕') + '</div>' : '') +
    explBlock(q) +
    '</div>' +
    '<div class="sticky-bottom">' +
    '<button class="btn" data-act="rvPrev" ' + (rv.idx === 0 ? 'disabled' : '') + '>← 前</button>' +
    '<button class="btn grow" data-act="rvNext" ' + (rv.idx === list.length - 1 ? 'disabled' : '') + '>次へ →</button>' +
    '</div>';
  state.reviewList = list;
  bindReviewToolbar();
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

/* ---------- 弱点（統計） ---------- */
function renderStatsDeck(deckId) {
  var d = Store.getDeck(deckId); if (!d) return show('stats');
  var at = Store.attempts(deckId);
  if (!at.length) {
    app.innerHTML = '<div class="card"><div class="row"><button class="btn ghost sm" data-act="back" data-to="stats">← 戻る</button>' +
      '<h3 class="grow" style="margin:0 0 0 8px">' + esc(d.name) + '</h3></div>' +
      '<div class="empty">まだ受験記録がありません。<br>試験モードを1回受けると、ここに弱点が出ます。<br>' +
      '<button class="btn primary" data-act="startExam" data-id="' + esc(deckId) + '" style="margin-top:12px">📝 試験を始める</button></div></div>';
    return;
  }
  var gs = genreStats(deckId), qs = qStats(deckId);
  var best = 0, lastP = pct(at[at.length - 1].correctCount, at[at.length - 1].total);
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
    grows += '<tr><td>' + esc(g.name) + '</td><td class="rt">' + g.correct + '/' + g.seen + '</td>' +
      '<td style="width:40%"><div class="meter"><i style="width:' + gp + '%;background:' + col + '"></i></div></td><td class="rt">' + gp + '%</td></tr>';
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
    '<div class="card"><div class="row"><button class="btn ghost sm" data-act="back" data-to="stats">← 戻る</button>' +
    '<h3 class="grow" style="margin:0 0 0 8px">' + esc(d.name) + ' 弱点</h3></div>' +
    '<div class="kpi" style="margin-top:10px">' +
    '<div class="b"><b>' + at.length + '</b><span class="small muted">受験回数</span></div>' +
    '<div class="b"><b>' + lastP + '%</b><span class="small muted">直近</span></div>' +
    '<div class="b"><b>' + best + '%</b><span class="small muted">ベスト</span></div></div></div>' +
    trendCard +
    '<div class="card"><h3>ジャンル別 正答率（弱い順）</h3><table class="tbl"><tr><th>ジャンル</th><th class="rt">正答</th><th></th><th class="rt">率</th></tr>' + grows + '</table></div>' +
    '<div class="card"><h3>よく間違える問題</h3>' + (mrows || '<div class="empty small">なし</div>') + '</div>' +
    '<div class="card"><h3>受験履歴</h3><table class="tbl"><tr><th>日時</th><th class="rt">率</th><th class="rt">正解</th><th class="rt">時間</th></tr>' + hrows + '</table></div>' +
    '<div class="card"><h3>🤖 弱点分析をAIに依頼</h3>' +
    '<p class="small muted">下のデータをコピーしてClaude等に貼ると、弱点分析・学習プランを作ってもらえます（問題文は含めず、ジャンル別成績とQ番号のみ）。</p>' +
    '<div class="btnrow"><button class="btn primary grow" data-act="copyWeak" data-id="' + esc(deckId) + '">📋 データをコピー</button>' +
    '<button class="btn grow" data-act="saveWeak" data-id="' + esc(deckId) + '">💾 .md保存</button></div></div>';
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
  back: function (t) { show(t.dataset.to); },
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
  bmEx: function () { var ex = state.exam, q = ex.qs[ex.idx]; BM.toggle(ex.deckId, q.num); renderExamRun(); },
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
  rvBm: function (t) { BM.toggle(state.review.deckId, parseInt(t.dataset.num, 10)); show('reviewRun', { deckId: state.review.deckId }); },
  rvFilter: function (t) { state.review.filter = t.dataset.f; state.review.idx = 0; show('reviewRun', { deckId: state.review.deckId }); },
  rvGenre: function (t) { state.review.filter = 'genre'; state.review.genre = t.dataset.g; state.review.idx = 0; show('reviewRun', { deckId: state.review.deckId }); },
  rvPrev: function () { if (state.review.idx > 0) { state.review.idx--; show('reviewRun', { deckId: state.review.deckId }); } },
  rvNext: function () { if (state.review.idx < state.reviewList.length - 1) { state.review.idx++; show('reviewRun', { deckId: state.review.deckId }); } },
  // weakness export
  copyWeak: function (t) { copyText(buildWeaknessMd(t.dataset.id)); },
  saveWeak: function (t) { var d = Store.getDeck(t.dataset.id); saveTextFile(d.name + '_学習データ.md', buildWeaknessMd(t.dataset.id)); toast('保存しました'); }
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
      e.preventDefault();
    }
  } else if (state.view === 'reviewRun' && state.review) {
    if (e.key === 'ArrowLeft') { if (state.review.idx > 0) { state.review.idx--; show('reviewRun', { deckId: state.review.deckId }); } }
    else if (e.key === 'ArrowRight') { if (state.review.idx < (state.reviewList || []).length - 1) { state.review.idx++; show('reviewRun', { deckId: state.review.deckId }); } }
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
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
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
show('home');

})();
