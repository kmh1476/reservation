// ── Firebase 모듈 동적 로드 (file:// 로컬 실행 + https 웹 배포 모두 호환) ──
// 주의: 이 파일은 일반 스크립트(비-module)로 로드해야 합니다.
//      <script type="module" src="script.js">로 바꾸면 Electron(file://) 로컬 실행 시
//      크로미움 CORS 정책 때문에 로드가 차단될 수 있습니다.
let initializeApp;
let getFirestore, collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, setDoc, getDoc, writeBatch, getDocs, query, where;
let signOut, getAuth;

(async function () {
  const appMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

  ({ initializeApp } = appMod);
  ({ getFirestore, collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, setDoc, getDoc, writeBatch, getDocs, query, where } = fsMod);
  ({ signOut, getAuth } = authMod);


// 렌더러 스크립트 최상단(혹은 DOMContentLoaded 직후)에 추가
(function () {
  const originalAlert = window.alert;
  window.alert = function (message) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.4);
      display:flex; align-items:center; justify-content:center;
      z-index:99999;`;
    const box = document.createElement('div');
    box.style.cssText = `
      background:#fff; padding:24px 28px; border-radius:8px;
      max-width:360px; box-shadow:0 4px 20px rgba(0,0,0,0.2);
      font-size:15px; line-height:1.5; text-align:center;`;
    box.innerHTML = `<div style="margin-bottom:16px;">${String(message)}</div>
      <button id="__customAlertOk" style="padding:6px 20px; border:none; border-radius:4px; background:#3b82f6; color:#fff; cursor:pointer;">확인</button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const btn = box.querySelector('#__customAlertOk');
    btn.focus();
    const close = () => {
      overlay.remove();
      // 모달이 닫힌 후 직전 입력창에 포커스 복귀
      const last = document.activeElement;
      setTimeout(() => last && last.blur && last.blur(), 0);
    };
    btn.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') close(); });
  };
})();

function customConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.4);
      display:flex; align-items:center; justify-content:center;
      z-index:99999;`;
    const box = document.createElement('div');
    box.style.cssText = `
      background:#fff; padding:24px 28px; border-radius:8px;
      max-width:360px; box-shadow:0 4px 20px rgba(0,0,0,0.2);
      font-size:15px; line-height:1.5; text-align:center; white-space:pre-line;`;
    box.innerHTML = `
      <div style="margin-bottom:16px;">${message}</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button id="__confirmOk" style="padding:6px 20px; border:none; border-radius:4px; background:#3b82f6; color:#fff; cursor:pointer;">확인</button>
        <button id="__confirmCancel" style="padding:6px 20px; border:none; border-radius:4px; background:#e5e7eb; color:#333; cursor:pointer;">취소</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const okBtn = box.querySelector('#__confirmOk');
    const cancelBtn = box.querySelector('#__confirmCancel');
    okBtn.focus();

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(true);
      if (e.key === 'Escape') close(false);
    });
  });
}

const firebaseConfig = {
  apiKey: "AIzaSyDFGcLsVUPWrczjPyT4caEg1o7zdKGN-b8",
  authDomain: "my-counsel-9b532.firebaseapp.com",
  projectId: "my-counsel-9b532",
  storageBucket: "my-counsel-9b532.firebasestorage.app",
  messagingSenderId: "51705550332",
  appId: "1:51705550332:web:67766fdeb1214524190e79"
};


const app = initializeApp(firebaseConfig);
window.app = app;

// 2. 앱이 켜진 것을 확인한 후, 안전하게 auth와 db를 로드합니다.
const auth = getAuth(app);
window.auth = auth;

const db = getFirestore(app);
window.db = db;

console.log("🔥 파이어베이스(App, Auth, DB) 거실에 등록 완료!");

const DAYS = ['mon','tue','wed','thu','fri'];
const DAY_LABELS = ['월','화','수','목','금'];
const PERIODS = 7;

let slotsCache = {}, bookingsCache = {};
let mealData = { lunch: [], dinner: [] };
let timetable = defaultTimetable();

// ── 상담 관리자 전용 변수 ──
let recordsCache = {};
let admYear, admMonth;
let admSelectedDate = null;
let adm_alertShown = false;
let _currentRecordBookingId = null;
let _statTab = 'overview';
const ADM_FIXED_TIMES = { lunch: '12:40 – 13:00', after: '15:10 – 15:30' };
let memos = [];

window.NEIS_API_KEY = "";
window.GEMS_API_KEY = ""; 
async function loadApiKeys() {
  try {
    // 1. Firestore에서 문서 가져오기
    const docRef = doc(db, "config", "apiKeys"); 
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      
      // 🔥 [디버깅] 파이어베이스에서 실제로 들고 온 필드명 눈으로 확인하기

      // 2. NEIS 키 매칭 (대소문자 방어)
      window.NEIS_API_KEY = data['NEIS:'] || data.NEIS || "";
if (window.NEIS_API_KEY) window.NEIS_API_KEY = window.NEIS_API_KEY.trim();
      
      // 3. GEMINI 키 매칭 (다양한 스펠링 방어)
      window.GEMS_API_KEY = data['GEMINI:'] || data.GEMINI || "";
if (window.GEMS_API_KEY) window.GEMS_API_KEY = window.GEMS_API_KEY.trim();
      
      console.log("🔒 API Keys 로드 완료");

      // 4. 키 주입 성공 후 급식/학사일정 함수 안전하게 호출
      if (window.NEIS_API_KEY) {
        if (typeof fetchNeisMeal === "function") fetchNeisMeal();
        if (typeof fetchSchoolSchedule === "function") {
          const now = new Date();
          fetchSchoolSchedule(now.getFullYear(), now.getMonth() + 1);
        }
      }
    } else {
      console.error("API 키 문서를 찾을 수 없습니다. (경로 확인 필요)");
    }
  } catch (e) {
    console.error("API 키 로드 중 치명적 실패:", e);
  }
}

// 💡 HTML 로드가 끝나면 자동으로 키를 불러오게 설정
loadApiKeys(); // (defer 스크립트라 DOM은 이미 준비됨 — DOMContentLoaded 대기 제거)
window.OFFICE_CODE = "B10";
window.SCHOOL_CODE = "7010083";

const SCHOOL_SCHEDULE = [
  { period: 1, start: "08:20", end: "09:10" },
  { period: 2, start: "09:20", end: "10:10" },
  { period: 3, start: "10:20", end: "11:10" },
  { period: 4, start: "11:20", end: "12:10" },
  { period: 5, start: "13:10", end: "14:00" },
  { period: 6, start: "14:10", end: "15:00" },
  { period: 7, start: "15:10", end: "16:00" }
];

// ── 로그인 ──
let adminPw = 'admin1234';

async function loadAdminPw() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'adminInfo'));
    if (snap.exists()) adminPw = snap.data().pw;
  } catch(e) {}
}

window.doMainLogin = async function() {
  await loadAdminPw();
  const val = document.getElementById('main-pw-input').value;
  const errEl = document.getElementById('main-login-err');
  if (val === adminPw) {
    document.getElementById('login-screen').style.display = 'none';
    const app = document.getElementById('main-app');
    app.style.display = 'flex';
    app.style.flexDirection = 'column';
    app.style.height = '100%';
    initApp();
  } else {
    errEl.textContent = '비밀번호가 틀렸습니다.';
    document.getElementById('main-pw-input').value = '';
    document.getElementById('main-pw-input').focus();
  }
};

// ── 로그인 버튼 이벤트 — 모듈 스코프에서 직접 바인딩 (onclick 인라인 대체) ──
(() => {
  const loginBtn = document.getElementById('main-login-btn');
  const pwInput  = document.getElementById('main-pw-input');
  if (loginBtn) loginBtn.addEventListener('click', window.doMainLogin);
  if (pwInput)  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') window.doMainLogin(); });
})(); // (defer 스크립트라 DOM은 이미 준비됨 — DOMContentLoaded 대기 제거)

// // ── 비밀번호 변경 모달 ──
// window.openPwModal = function() { document.getElementById('pw-modal').classList.add('show'); };
// window.closePwModal = function() {
//   document.getElementById('pw-modal').classList.remove('show');
//   document.getElementById('pw-cur').value = '';
//   document.getElementById('pw-new').value = '';
//   document.getElementById('pw-new2').value = '';
//   document.getElementById('pw-modal-msg').textContent = '';
// };


window.doChangePw = async function() {
  const cur = document.getElementById('pw-cur').value;
  const nw = document.getElementById('pw-new').value;
  const nw2 = document.getElementById('pw-new2').value;
  const msg = document.getElementById('pw-modal-msg');
  if (cur !== adminPw) { msg.style.color='red'; msg.textContent='현재 비밀번호가 틀립니다.'; return; }
  if (nw.length < 4) { msg.style.color='red'; msg.textContent='새 비밀번호는 4자 이상이어야 합니다.'; return; }
  if (nw !== nw2) { msg.style.color='red'; msg.textContent='새 비밀번호가 일치하지 않습니다.'; return; }
  try {
    await setDoc(doc(db,'settings','adminInfo'),{pw:nw});
    adminPw = nw;
    msg.style.color='green'; msg.textContent='✅ 비밀번호가 변경되었습니다.';
    setTimeout(closePwModal, 1500);
  } catch(e) { msg.style.color='red'; msg.textContent='저장 실패. 다시 시도하세요.'; }
};

// ── 클래스 탭 시스템 ──
const DEFAULT_CLASS_TABS = [
  { id: 'homeroom', label: '담임' },
];
let classTabs = [...DEFAULT_CLASS_TABS];
let currentClassTabId = classTabs[0].id;
let editingClassTabs = [];

async function loadClassTabs() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'classTabs'));
    if (snap.exists() && Array.isArray(snap.data().list) && snap.data().list.length > 0) {
      classTabs = snap.data().list;
    }
  } catch(e) { console.warn('클래스탭 Firebase 로드 실패(localStorage 폴백):', e); 
    try { const s=localStorage.getItem('hmm_class_tabs'); if(s) classTabs=JSON.parse(s); } catch(_){} 
  }
  currentClassTabId = classTabs[0]?.id || 'homeroom';
}

async function saveClassTabsLocal() {
  try {
    await setDoc(doc(db, 'settings', 'classTabs'), { list: classTabs });
    localStorage.setItem('hmm_class_tabs', JSON.stringify(classTabs));
  } catch(e) { 
    console.warn('Firebase 저장 실패, localStorage만 저장:', e);
    localStorage.setItem('hmm_class_tabs', JSON.stringify(classTabs));
  }
}

function renderClassTabBar() {
  const bar = document.getElementById('class-tab-bar');
  // 기존 탭 버튼들 제거 (⚙️ 버튼 제외)
  bar.querySelectorAll('.class-tab-btn').forEach(b => b.remove());
  const editBtn = bar.querySelector('.class-tab-edit-btn');
  classTabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = `class-tab-btn${tab.id === currentClassTabId ? ' active' : ''}`;
    btn.textContent = tab.label;
    btn.onclick = () => switchClassTab(tab.id);
    bar.insertBefore(btn, editBtn);
  });
}

function switchClassTab(tabId) {
  currentClassTabId = tabId;
  currentStudentId = null;
  currentStudentName = '';
  if (unsubscribeRecords) { unsubscribeRecords(); unsubscribeRecords = null; }
  document.getElementById('record-empty-notice').style.display = 'flex';
  document.getElementById('record-main-panel').style.display = 'none';

  const tab = classTabs.find(t => t.id === tabId);
  document.getElementById('student-panel-title').textContent = `${tab?.label || ''} 학생 명렬`;

  renderClassTabBar();
  subscribeStudents(tabId);
}

// ── 클래스 탭 편집 모달 ──
window.openClassTabModal = function() {
  editingClassTabs = classTabs.map(t => ({...t}));
  renderClassTabEditList();
  document.getElementById('classtab-modal').classList.add('show');
};
window.closeClassTabModal = function() {
  document.getElementById('classtab-modal').classList.remove('show');
};
function renderClassTabEditList() {
  const list = document.getElementById('classtab-edit-list');
  list.innerHTML = '';
  editingClassTabs.forEach((tab, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    row.innerHTML = `
      <span style="color:#ccc;cursor:grab;font-size:1rem;padding:0 4px;">⠿</span>
      <input value="${tab.label}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);background:var(--paper);font-size:.85rem;font-family:inherit;outline:none;border-radius:4px;" oninput="updateEditTab(${i}, this.value)">
      ${editingClassTabs.length > 1 ? `<button onclick="removeEditTab(${i})" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:1rem;padding:2px 6px;">✕</button>` : ''}
    `;
    list.appendChild(row);
  });
}
window.updateEditTab = function(i, val) { editingClassTabs[i].label = val; };
window.removeEditTab = function(i) {
  editingClassTabs.splice(i, 1);
  renderClassTabEditList();
};
window.addClassTab = function() {
  const input = document.getElementById('classtab-new-input');
  const val = input.value.trim();
  if (!val) return;
  const newId = 'class_' + Date.now();
  editingClassTabs.push({ id: newId, label: val });
  input.value = '';
  renderClassTabEditList();
};
window.saveClassTabs = async function() {
  if (editingClassTabs.some(t => !t.label.trim())) {
    alert('탭 이름을 모두 입력해주세요.'); return;
  }
  classTabs = editingClassTabs.map(t => ({ id: t.id, label: t.label.trim() }));
  await saveClassTabsLocal();
  if (!classTabs.find(t => t.id === currentClassTabId)) {
    currentClassTabId = classTabs[0].id;
  }
  renderClassTabBar();
  switchClassTab(currentClassTabId);
  closeClassTabModal();
};

// ── 학생 기록 태그(카테고리) 관리 ──
const DEFAULT_RECORD_CATEGORIES = ['물리학 과세특', '행발', '진로/창체', '상담/기타'];
let recordCategories = [...DEFAULT_RECORD_CATEGORIES];
let editingRecordCategories = [];

async function loadRecordCategories() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'recordCategories'));
    if (snap.exists() && Array.isArray(snap.data().list) && snap.data().list.length > 0) {
      recordCategories = snap.data().list;
    }
  } catch(e) { console.warn('기록 태그 Firebase 로드 실패(localStorage 폴백):', e);
    try { const s=localStorage.getItem('hmm_record_categories'); if(s) recordCategories=JSON.parse(s); } catch(_){}
  }
  renderRecordCategorySelect();
}

async function saveRecordCategoriesLocal() {
  try {
    await setDoc(doc(db, 'settings', 'recordCategories'), { list: recordCategories });
    localStorage.setItem('hmm_record_categories', JSON.stringify(recordCategories));
  } catch(e) {
    console.warn('Firebase 저장 실패, localStorage만 저장:', e);
    localStorage.setItem('hmm_record_categories', JSON.stringify(recordCategories));
  }
}

function renderRecordCategorySelect() {
  const sel = document.getElementById('record-category');
  if (!sel) return;
  const prevVal = sel.value;
  sel.innerHTML = recordCategories.map(c => `<option value="${c}">${c}</option>`).join('');
  if (recordCategories.includes(prevVal)) sel.value = prevVal;
}

window.openRecordCategoryModal = function() {
  editingRecordCategories = [...recordCategories];
  renderRecordCategoryEditList();
  document.getElementById('categorytag-modal').classList.add('show');
};
window.closeRecordCategoryModal = function() {
  document.getElementById('categorytag-modal').classList.remove('show');
};
function renderRecordCategoryEditList() {
  const list = document.getElementById('categorytag-edit-list');
  list.innerHTML = '';
  editingRecordCategories.forEach((tag, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    row.innerHTML = `
      <input value="${tag}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);background:var(--paper);font-size:.85rem;font-family:inherit;outline:none;border-radius:4px;" oninput="updateEditCategoryTag(${i}, this.value)">
      ${editingRecordCategories.length > 1 ? `<button onclick="removeEditCategoryTag(${i})" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:1rem;padding:2px 6px;">✕</button>` : ''}
    `;
    list.appendChild(row);
  });
}
window.updateEditCategoryTag = function(i, val) { editingRecordCategories[i] = val; };
window.removeEditCategoryTag = function(i) {
  editingRecordCategories.splice(i, 1);
  renderRecordCategoryEditList();
};
window.addRecordCategoryTag = function() {
  const input = document.getElementById('categorytag-new-input');
  const val = input.value.trim();
  if (!val) return;
  editingRecordCategories.push(val);
  input.value = '';
  renderRecordCategoryEditList();
};
window.saveRecordCategories = async function() {
  const cleaned = editingRecordCategories.map(t => t.trim()).filter(Boolean);
  if (!cleaned.length) { alert('태그를 최소 1개 이상 입력해주세요.'); return; }
  recordCategories = cleaned;
  await saveRecordCategoriesLocal();
  renderRecordCategorySelect();
  closeRecordCategoryModal();
};

// ── 앱 초기화 (로그인 후 호출) ──
async function initApp() {
  await loadClassTabs();
  await loadRecordCategories();
  await loadApiKeys();
  renderClassTabBar();
  updateClock();
  fetchNeisMeal();
  subscribeStudents(currentClassTabId);

  onSnapshot(doc(db,'timetable','weekly'), snap => {
    timetable = snap.exists() ? snap.data() : defaultTimetable();
    renderTimetable(); updateClock();
  });
  onSnapshot(doc(db,'memos','list'), snap => {
    memos = snap.exists()?(snap.data().list||[]):[];
    renderMemos();
  });
  onSnapshot(collection(db,'slots'), snap => {
    slotsCache={};snap.forEach(d=>slotsCache[d.id]=d.data());
    _slotsReady=true;maybeUpdate();
    // 상담 관리자 탭 업데이트
    admRenderCal();
    if (admSelectedDate) admRenderSlotPanel(admSelectedDate);
    admMaybeShowTodayAlert();
  });
  onSnapshot(collection(db,'bookings'), snap => {
    bookingsCache={};snap.forEach(d=>{const b=d.data();b.id=d.id;if(!bookingsCache[b.date])bookingsCache[b.date]=[];bookingsCache[b.date].push(b);});
    _bookingsReady=true;maybeUpdate();
    // 상담 관리자 탭 업데이트
    admRenderCal();
    if (admSelectedDate) admRenderBookingPanel(admSelectedDate);
    admMaybeShowTodayAlert();
  });
  onSnapshot(collection(db,'records'), snap => {
    recordsCache = {};
    snap.forEach(d => { recordsCache[d.id] = d.data(); });
    if (admSelectedDate) admRenderBookingPanel(admSelectedDate);
  });
  onSnapshot(doc(db,'cal_notes','data'), snap => {
    calNotes = snap.exists() ? (snap.data().notes||{}) : {};
    window.calNotes = calNotes; // 확실하게 전역 변수로 공유
  
  // ⚠️ 기존 renderMiniCalDots(); 대신 달력 전체를 다시 그리도록 수정!
  if (typeof renderMiniCal === "function") {
    renderMiniCal(); 
  }
  // ─────────────────

  updateAlertBanner(); // 달력 메모 변경 시 알림 배너도 갱신
  if (currentViewDate) {
    const evts = (scheduleCache[`${miniCalYear}-${String(miniCalMonth).padStart(2,'0')}`]||[]).filter(e=>e.date===currentViewDate);
    showScheduleForDate(currentViewDate, evts, true);
  }
  });
  onSnapshot(collection(db,'ddays'), snap => {
    const container=document.getElementById('dday-container');const manageList=document.getElementById('dday-manage-list');
    container.innerHTML='';if(manageList)manageList.innerHTML='';
    const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const items=[];
    snap.forEach(sd=>{const data=sd.data();if(!data.title||!data.targetDate)return;items.push({id:sd.id,...data,obj:new Date(data.targetDate)});});
    items.sort((a,b)=>a.obj-b.obj);
    items.forEach((item,index)=>{
      const td=new Date(item.obj.getFullYear(),item.obj.getMonth(),item.obj.getDate());
      const diff=Math.ceil((td-today)/(1000*60*60*24));
      const ddayText=diff===0?'D-DAY':diff>0?`D-${diff}`:`D+${Math.abs(diff)}`;
      const badge=document.createElement('span');badge.className=`dday-badge dday-clr-${index%4}`;badge.title=item.targetDate;
      badge.innerHTML=`<span>${item.title}</span> <span style="opacity:.85;font-size:.65rem;">${ddayText}</span>`;
      container.appendChild(badge);
      if(manageList){
        const el=document.createElement('div');el.style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--paper);border-radius:4px;font-size:0.85rem;border:1px solid var(--border);";
        el.innerHTML=`<div><strong>${item.title}</strong> <span style="font-size:.75rem;color:var(--muted);margin-left:6px;">(${item.targetDate})</span></div><button onclick="deleteDDay('${item.id}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.85rem;padding:2px 6px;">삭제</button>`;
        manageList.appendChild(el);
      }
    });
    if(manageList&&snap.empty)manageList.innerHTML='<div style="color:var(--muted);font-size:.82rem;text-align:center;padding:16px 0;">등록된 디데이가 없습니다.</div>';
  });

  (function initMiniCal(){
    const now=new Date(); miniCalYear=now.getFullYear(); miniCalMonth=now.getMonth()+1;
    fetchSchoolSchedule(miniCalYear,miniCalMonth);
  })();

  // ── 상담 관리자 초기화 ──
  admInitApp();
}

// 전역 변수 세팅
  window.SCHOOL_SCHEDULE = [];
  window.LUNCH_AFTER = 4; // 기본값 4교시

  // ── [A] Firebase 실시간 동기화 (핸드폰, PC 공통) ──
  onSnapshot(doc(db, "schedules", "today"), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      window.SCHOOL_SCHEDULE = data.list;
      window.LUNCH_AFTER = data.lunchAfter || 4;
      
      // UI 동기화 (다른 기기에서 바꿨을 때 내 화면도 바뀜)
      if(document.getElementById('startTime')) document.getElementById('startTime').value = data.startTime || "08:30";
      const radioEl = document.querySelector(`input[name="lunchAfter"][value="${window.LUNCH_AFTER}"]`);
      if(radioEl) radioEl.checked = true;
      if (data.officeCode && data.schoolCode) {
      const isChanged = (window.OFFICE_CODE !== data.officeCode || window.SCHOOL_CODE !== data.schoolCode);
      
      window.OFFICE_CODE = data.officeCode;
      window.SCHOOL_CODE = data.schoolCode;
      
      // 만약 학교 코드가 기존과 달라졌다면, 급식/학사일정 함수를 새로 호출합니다.
      if (isChanged) {
        console.log(`학교 변경 감지됨: ${window.OFFICE_CODE} / ${window.SCHOOL_CODE}`);
        // 💡 여기에 선생님이 기존에 쓰시던 급식/학사일정 호출 함수 이름을 넣어주세요!
// 올바른 호출 방법
      if (typeof fetchNeisMeals === "function") fetchNeisMeals(); 
      if (typeof saveCalNotes === "function") saveCalNotes();
      }
    }
    }




  });

  // ── [B] 시간표 자동 생성 및 저장 (버튼 클릭 시 실행) ──
  window.applySchedule = async function(duration) {
    const startTimeInput = document.getElementById('startTime').value;
    if (!startTimeInput) return alert("시작 시간을 입력해주세요.");

    const lunchAfterPeriod = Number(document.querySelector('input[name="lunchAfter"]:checked').value);
    const [startH, startM] = startTimeInput.split(':').map(Number);
    let currentMins = startH * 60 + startM;

    const newSchedule = [];
    const BREAK_TIME = 10;   // 일반 쉬는 시간 (10분)
    const LUNCH_TIME = 60;   // 점심 시간 (60분)
    const TOTAL_PERIODS = 7; // 총 7교시

    for (let i = 1; i <= TOTAL_PERIODS; i++) {
      const sH = Math.floor(currentMins / 60);
      const sM = currentMins % 60;
      const startTimeStr = `${String(sH).padStart(2,'0')}:${String(sM).padStart(2,'0')}`;

      currentMins += duration;
      const eH = Math.floor(currentMins / 60);
      const eM = currentMins % 60;
      const endTimeStr = `${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}`;

      newSchedule.push({ period: i, start: startTimeStr, end: endTimeStr });

      // 선택한 교시 이후에 점심시간 적용
      if (i === lunchAfterPeriod) {
        currentMins += LUNCH_TIME; 
      } else {
        currentMins += BREAK_TIME; 
      }
    }

    try {
      await setDoc(doc(db, "schedules", "today"), {
        startTime: startTimeInput,
        duration: duration,
        lunchAfter: lunchAfterPeriod,
        list: newSchedule,
        updatedAt: new Date()
      });
      alert(`${duration}분 수업 시간표가 전 기기에 적용되었습니다!`);
    } catch (e) {
      console.error("저장 에러: ", e);
    }
  }

  // ── [C] 시계 및 상태 업데이트 (기존 함수 교체) ──
  function updateClock() {
    const now = new Date();
    const days = ['일','월','화','수','목','금','토'];
    
    // 주말 예외 처리 (선택)
    if (now.getDay() === 0 || now.getDay() === 6) {
      const txtEl = document.getElementById('p-text');
      const timerEl = document.getElementById('p-timer');
      if(txtEl) txtEl.textContent = "주말/휴일";
      if(timerEl) timerEl.textContent = "";
      return;
    }

    if(document.getElementById('topbar-date')) {
      document.getElementById('topbar-date').textContent = `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;
    }
    if(document.getElementById('topbar-clock')) {
      document.getElementById('topbar-clock').textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    }
    
    updatePeriodStatus(now);
  }

  function updatePeriodStatus(now) {
    const txtEl = document.getElementById('p-text');
    const timerEl = document.getElementById('p-timer');

    // 예외 처리: 데이터가 아직 로드되지 않았을 때
    if (!window.SCHOOL_SCHEDULE || window.SCHOOL_SCHEDULE.length === 0) {
      if (txtEl) txtEl.textContent = "시간표 불러오는 중...";
      return;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const seconds = now.getSeconds();
    
    document.querySelectorAll('#tt-body tr').forEach(tr => tr.classList.remove('current-period-row'));

    const firstStart = window.SCHOOL_SCHEDULE[0].start.split(':').map(Number);
    const firstStartMins = firstStart[0] * 60 + firstStart[1];
    const lastEnd = window.SCHOOL_SCHEDULE[window.SCHOOL_SCHEDULE.length-1].end.split(':').map(Number);
    const lastEndMins = lastEnd[0] * 60 + lastEnd[1];

    const secText = seconds === 0 ? 0 : 60 - seconds;
    const minOffset = seconds === 0 ? 0 : 1;

    if (currentMinutes >= lastEndMins) {
      if (txtEl) txtEl.textContent = "방과후";
      if (timerEl) timerEl.textContent = "";
      return;
    }

    if (currentMinutes < firstStartMins) {
      const diff = firstStartMins - currentMinutes - minOffset;
      if (txtEl) txtEl.textContent = "일과 전";
      if (timerEl) timerEl.textContent = `${diff}분 ${secText}초 전`;
      return;
    }

    let statusText = "", remainingText = "", currentPeriod = null;

    for (let i = 0; i < window.SCHOOL_SCHEDULE.length; i++) {
      const s = window.SCHOOL_SCHEDULE[i];
      const [sH, sM] = s.start.split(':').map(Number);
      const [eH, eM] = s.end.split(':').map(Number);
      const st = sH * 60 + sM;
      const et = eH * 60 + eM;

      if (currentMinutes >= st && currentMinutes < et) {
        currentPeriod = s.period;
        const diff = et - currentMinutes - minOffset;
        statusText = `${s.period}교시`;
        remainingText = `${diff}분 ${secText}초 남음`;
        break;
      }

      if (i < window.SCHOOL_SCHEDULE.length - 1) {
        const ns = window.SCHOOL_SCHEDULE[i + 1];
        const [nsH, nsM] = ns.start.split(':').map(Number);
        const nst = nsH * 60 + nsM;

        if (currentMinutes >= et && currentMinutes < nst) {
          const diff = nst - currentMinutes - minOffset;
          
          // 동적 점심시간 적용부
          const targetLunchPeriod = window.LUNCH_AFTER || 4; 
          if (s.period === targetLunchPeriod && ns.period === (targetLunchPeriod + 1)) {
            statusText = "점심시간 🍱";
          } else {
            statusText = "쉬는 시간";
          }
          
          remainingText = `${ns.period}교시까지 ${diff}분 ${secText}초`;
          break;
        }
      }
    }

    if (txtEl) txtEl.innerHTML = statusText;
    if (timerEl) timerEl.textContent = remainingText;

    if (currentPeriod && document.getElementById('tt-body')) {
      const r = document.getElementById('tt-body').children[currentPeriod - 1];
      if (r) r.classList.add('current-period-row');
    }
  }

  // 매초 실행
  setInterval(updateClock, 1000);
  updateClock();

// ── 탭 ──
window.switchTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id==='tab-'+tab));
};
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ── 시간표 ──
function defaultTimetable() { const tt={}; for(let p=1;p<=PERIODS;p++){tt[p]={};DAYS.forEach(d=>tt[p][d]='');} return tt; }

function renderTimetable() {
  const dow=new Date().getDay(); const todayCol=dow>=1&&dow<=5?DAYS[dow-1]:null;
  DAYS.forEach((d,i) => { const th=document.getElementById('th-'+d); if(th){th.className=d===todayCol?'today-col':''; th.textContent=DAY_LABELS[i]+(d===todayCol?' ★':'');} });
  const tbody=document.getElementById('tt-body'); tbody.innerHTML='';
  for(let p=1;p<=PERIODS;p++){
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="period">${p}교</td>`+DAYS.map(d=>{const v=timetable[p]?.[d]||'';const cls=d===todayCol?'today-col':(v===''?'empty':'');return`<td class="${cls}"><span class="tt-cell-text">${v||'—'}</span></td>`;}).join('');
    tbody.appendChild(tr);
  }
  requestAnimationFrame(fitTimetableText);
}

// ── 시간표 칸에 맞춰 글씨 크기 자동 축소 ──
const TT_FONT_MAX = 0.62; // .tt-table td 기본 font-size(rem)와 동일
const TT_FONT_MIN = 0.42; // 이 이하로는 줄이지 않고 말줄임(...) 처리에 맡김
function fitTimetableText() {
  document.querySelectorAll('#tt-body td:not(.period) .tt-cell-text').forEach(span => {
    const td = span.parentElement;
    let size = TT_FONT_MAX;
    span.style.fontSize = size + 'rem';
    while (span.scrollWidth > td.clientWidth && size > TT_FONT_MIN) {
      size -= 0.02;
      span.style.fontSize = size.toFixed(2) + 'rem';
    }
  });
}
let ttResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(ttResizeTimer);
  ttResizeTimer = setTimeout(fitTimetableText, 150);
});
async function saveTimetable() {
  const tt={};
  for(let p=1;p<=PERIODS;p++){tt[p]={};DAYS.forEach(d=>{tt[p][d]=document.getElementById(`tt-${p}-${d}`)?.value.trim()||'';});}
  try { await setDoc(doc(db,'timetable','weekly'),tt); closeTTEdit(); } catch(e) { alert("시간표 저장 실패"); }
}
window.saveTimetable=saveTimetable;
function openTTEdit() {
  const tbody=document.getElementById('tt-edit-body'); tbody.innerHTML='';
  for(let p=1;p<=PERIODS;p++){
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="text-align:center;font-size:.78rem;color:var(--muted);padding:4px 8px">${p}교시</td>`+DAYS.map(d=>`<td><input id="tt-${p}-${d}" value="${timetable[p]?.[d]||''}" placeholder="—"></td>`).join('');
    tbody.appendChild(tr);
  }
  document.getElementById('tt-modal').classList.add('show');
}
function closeTTEdit() { document.getElementById('tt-modal').classList.remove('show'); }
window.openTTEdit=openTTEdit; window.closeTTEdit=closeTTEdit;

// ── 급식 ──
let currentMealDate = new Date();
function formatMealDateLabel(d) {
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const label = `${d.getMonth()+1}월 ${d.getDate()}일`;
  return isToday ? `오늘 (${label})` : label;
}
async function fetchNeisMeal(targetDate) {
  if (targetDate) currentMealDate = targetDate;
  const schoolLabel=document.getElementById('meal-school');
  const dateLabel=document.getElementById('meal-date-label');
  const now=currentMealDate;
  if (dateLabel) dateLabel.textContent = formatMealDateLabel(now);
  const yyyymmdd=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const url=`https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${window.NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${window.OFFICE_CODE}&SD_SCHUL_CODE=${window.SCHOOL_CODE}&MLSV_YMD=${yyyymmdd}`;
  try {
    const res=await fetch(url); const data=await res.json(); mealData={lunch:[],dinner:[]};
    if(data.mealServiceDietInfo){
      const items=data.mealServiceDietInfo[1].row; schoolLabel.textContent=items[0].SCHUL_NM;
      items.forEach(row=>{
        const menuClean=row.DDISH_NM.split('<br/>').map(m=>m.replace(/[0-9.()]/g,'').trim()).filter(Boolean);
        if(row.MMEAL_SC_CODE==="2") mealData.lunch=menuClean;
        else if(row.MMEAL_SC_CODE==="3") mealData.dinner=menuClean;
      });
    } else { schoolLabel.textContent="급식 없음 (주말/공휴일)"; }
  } catch(e) { schoolLabel.textContent="데이터 에러"; }
  renderMeal('lunch'); renderMeal('dinner');
}
window.changeMealDate = function(delta) {
  const d = new Date(currentMealDate);
  d.setDate(d.getDate() + delta);
  fetchNeisMeal(d);
};
window.resetMealDate = function() {
  fetchNeisMeal(new Date());
};
function renderMeal(type) {
  const el=document.getElementById(`meal-${type}-content`); const items=mealData[type];
  if(!items||!items.length){el.innerHTML=`<p class="meal-loading">오늘 ${type==='lunch'?'중식':'석식'} 정보가 없습니다.</p>`;return;}
  el.innerHTML=`<ul class="meal-list">${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
}
window.showMeal=function(type,btn){
  document.querySelectorAll('.meal-tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active');
  document.getElementById('meal-lunch-content').style.display=type==='lunch'?'':'none';
  document.getElementById('meal-dinner-content').style.display=type==='dinner'?'':'none';
};

// ── 메모 ──
window.renderMemos=function(){
  const container=document.getElementById('memo-items'); container.innerHTML='';
  if(!memos||!memos.length){container.innerHTML='<div class="memo-empty">할 일을 추가해보세요 ✏️</div>';return;}
  memos.forEach((m,i)=>{
    const div=document.createElement('div'); div.className='memo-item'; div.draggable=true; div.dataset.idx=i;
    div.innerHTML=`
      <span class="memo-drag" title="드래그해서 순서 변경">⠿</span>
      <input type="checkbox" class="memo-cb" ${m.done?'checked':''} onchange="toggleMemo(${i})">
      <span class="memo-text ${m.done?'done':''}" id="memo-text-${i}">${m.text}</span>
      <button class="memo-edit-btn" onclick="startEditMemo(${i})" title="수정">✏️</button>
      <button class="memo-del" onclick="deleteMemo(${i})">✕</button>
    `;
    div.addEventListener('dragstart', e=>{e.dataTransfer.setData('text/plain',i);setTimeout(()=>div.classList.add('dragging'),0);});
    div.addEventListener('dragend', ()=>div.classList.remove('dragging'));
    div.addEventListener('dragover', e=>{e.preventDefault();div.classList.add('drag-over');});
    div.addEventListener('dragleave', ()=>div.classList.remove('drag-over'));
    div.addEventListener('drop', async e=>{e.preventDefault();div.classList.remove('drag-over');const from=parseInt(e.dataTransfer.getData('text/plain'));const to=parseInt(div.dataset.idx);if(from===to)return;const u=[...memos];const[moved]=u.splice(from,1);u.splice(to,0,moved);await syncMemos(u);});
    container.appendChild(div);
  });
};
window.startEditMemo=function(i){
  const textEl=document.getElementById('memo-text-'+i); if(!textEl)return;
  const cur=memos[i].text; const item=textEl.closest('.memo-item');
  textEl.style.display='none';
  const input=document.createElement('input'); input.className='memo-edit-input'; input.value=cur;
  item.insertBefore(input,textEl.nextSibling); input.focus(); input.select();
  const save=async()=>{const t=input.value.trim();if(t&&t!==cur){const u=[...memos];u[i].text=t;await syncMemos(u);}else{renderMemos();}};
  input.addEventListener('keydown',e=>{if(e.key==='Enter')save();if(e.key==='Escape')renderMemos();});
  input.addEventListener('blur',save);
};
async function syncMemos(m){try{await setDoc(doc(db,'memos','list'),{list:m});}catch(e){console.error(e);}}
window.addMemo=async function(){const input=document.getElementById('memo-input');const text=input.value.trim();if(!text)return;await syncMemos([...memos,{text,done:false}]);input.value='';};
window.toggleMemo=async function(i){const u=[...memos];u[i].done=!u[i].done;await syncMemos(u);};
window.deleteMemo=async function(i){const u=[...memos];u.splice(i,1);await syncMemos(u);};

// ── 알림 배너 ──
function todayStr(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function updateAlertBanner(){
  const today=todayStr();
  const books=bookingsCache[today]||[];
  const slotData=slotsCache[today]||{};const customs=slotData.custom||[];const FIXED_LABEL={lunch:'점심',after:'방과후'};

  // 달력 메모: calNotes 키는 'YYYYMMDD' 형식
  const todayKey=today.replace(/-/g,'');
  const todayNotes=(calNotes[todayKey]||[]);

  const banner=document.getElementById('alert-banner');
  const ico=document.getElementById('alert-ico');
  const title=document.getElementById('alert-title');
  const list=document.getElementById('alert-list');

  const hasBooks=books.length>0;
  const hasNotes=todayNotes.length>0;

  if(!hasBooks&&!hasNotes){
    banner.className='alert-banner none';
    ico.textContent='✅';
    title.className='alert-title none';
    title.textContent='오늘 예정된 상담과 일정이 없어요';
    list.className='alert-list none';
    list.textContent='편안한 하루 되세요 😊';
    return;
  }

  banner.className='alert-banner';
  ico.textContent='🔔';
  title.className='alert-title';
  const titleParts=[];
  if(hasBooks) titleParts.push(`상담 ${books.length}건`);
  if(hasNotes) titleParts.push(`일정 ${todayNotes.length}건`);
  title.textContent=`오늘 ${titleParts.join(' · ')}이 있어요`;

  const parts=[];
  if(hasBooks){
    const sorted=[...books].sort((a,b)=>({lunch:0,after:1,custom:2}[a.type]??2)-({lunch:0,after:1,custom:2}[b.type]??2));
    sorted.forEach(b=>{
      let label=FIXED_LABEL[b.type]||'';let time=b.type==='lunch'?'12:40':b.type==='after'?'15:10':'';
      if(b.type==='custom'){const cs=customs[b.customIdx];if(cs){label=cs.name;time=cs.start;}}
      parts.push(`🗣 ${label}(${time}) — ${b.name}`);
    });
  }
  if(hasNotes){
    todayNotes.forEach(n=>parts.push(`📅 ${n}`));
  }
  list.className='alert-list';
  list.innerHTML=parts.map(p=>`<span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p}</span>`).join('');
}
let _slotsReady=false,_bookingsReady=false;
function maybeUpdate(){if(_slotsReady&&_bookingsReady)updateAlertBanner();}

// ── 디데이 ──
window.openDDayModal=function(){document.getElementById('dday-modal').classList.add('show');};
window.closeDDayModal=function(){document.getElementById('dday-modal').classList.remove('show');document.getElementById('dday-title-input').value='';document.getElementById('dday-date-input').value='';};
window.addDDay=async function(){
  const ti=document.getElementById('dday-title-input');const di=document.getElementById('dday-date-input');
  const title=ti.value.trim();const targetDate=di.value;
  if(!title||!targetDate){alert('이름과 날짜를 입력해주세요!');return;}
  try{await addDoc(collection(db,'ddays'),{title,targetDate});ti.value='';di.value='';}catch(e){alert("저장 실패");}
};
window.deleteDDay=async function(id){if(!(await customConfirm('삭제하시겠습니까?')))return;try{await deleteDoc(doc(db,'ddays',id));}catch(e){alert("삭제 실패");}};

// ── 학사일정 달력 ──
let miniCalYear, miniCalMonth;
let scheduleCache = {};
let calNotes = {};
let currentViewDate = null;

async function saveCalNotes(){ await setDoc(doc(db,'cal_notes','data'),{notes:calNotes}); }

window.miniCalMove=function(dir){
  miniCalMonth+=dir;
  if(miniCalMonth>12){miniCalMonth=1;miniCalYear++;}
  if(miniCalMonth<1){miniCalMonth=12;miniCalYear--;}
  currentViewDate=null;
  renderMiniCal();
  const key=`${miniCalYear}-${String(miniCalMonth).padStart(2,'0')}`;
  if(!scheduleCache[key])fetchSchoolSchedule(miniCalYear,miniCalMonth);
};
async function fetchSchoolSchedule(year,month){
  const key=`${year}-${String(month).padStart(2,'0')}`;
  const ym=`${year}${String(month).padStart(2,'0')}`;
  
  // 🔥 window.OFFICE_CODE와 window.SCHOOL_CODE를 확실하게 바라보도록 수정
  const url=`https://open.neis.go.kr/hub/SchoolSchedule?KEY=${window.NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${window.OFFICE_CODE}&SD_SCHUL_CODE=${window.SCHOOL_CODE}&AA_YMD=${ym}`;
  
  try{
    const res=await fetch(url);
    const data=await res.json();
    const rows=data?.SchoolSchedule?.[1]?.row||[];
    scheduleCache[key]=rows.map(r=>({
      date:r.AA_YMD,
      name:r.EVENT_NM,
      isHoliday:r.EVENT_NM.includes('방학')||r.EVENT_NM.includes('휴업')||r.EVENT_NM.includes('공휴일')
    }));
  }catch(e){
    scheduleCache[key]=[];
  }
  window.renderMiniCal();
}

window.renderMiniCal=function(){
  const key=`${miniCalYear}-${String(miniCalMonth).padStart(2,'0')}`;
  const events=scheduleCache[key]||null;
  document.getElementById('mini-cal-title').textContent=`${miniCalYear}년 ${miniCalMonth}월`;
  const grid=document.getElementById('mini-cal-grid'); grid.innerHTML='';

  const firstDay=new Date(miniCalYear,miniCalMonth-1,1).getDay();
  const lastDate=new Date(miniCalYear,miniCalMonth,0).getDate();
  const now=new Date();
  const todayStr2=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  for(let i=0;i<firstDay;i++){const el=document.createElement('div');el.className='mini-cal-cell empty';grid.appendChild(el);}

  for(let d=1;d<=lastDate;d++){
    const dateStr=`${miniCalYear}${String(miniCalMonth).padStart(2,'0')}${String(d).padStart(2,'0')}`;
    const dow=new Date(miniCalYear,miniCalMonth-1,d).getDay();
    const dayEvts=events?events.filter(e=>e.date===dateStr):[];
    const hasNote=(calNotes[dateStr]||[]).length>0;
    const isToday=dateStr===todayStr2;
    const isSelected=dateStr===currentViewDate;

    const cell=document.createElement('div');
    let cls='mini-cal-cell';
    if(isToday)cls+=' today';
    if(dow===0)cls+=' sun';
    if(dow===6)cls+=' sat';
    if(dayEvts.length)cls+=' has-event';
    if(hasNote)cls+=' has-memo';
    if(isSelected)cls+=' selected';
    cell.className=cls;

    let inner=`<div class="mini-day">${d}</div>`;
    dayEvts.slice(0,2).forEach(ev=>{
      inner+=`<div class="cal-event-tag ${ev.isHoliday?'holiday':'school'}">${ev.name}</div>`;
    });
    if(dayEvts.length>2) inner+=`<div class="cal-event-tag school">+${dayEvts.length-2}</div>`;
    cell.innerHTML=inner;
    cell.onclick=()=>showScheduleForDate(dateStr,dayEvts);
    grid.appendChild(cell);
  }

  if(currentViewDate){
    const evts=events?events.filter(e=>e.date===currentViewDate):[];
    showScheduleForDate(currentViewDate,evts,true);
  } else {
    renderMonthEventList(events,key);
  }
};

function renderMonthEventList(events){
  const detailEmpty=document.getElementById('cal-detail-empty');
  const detailContent=document.getElementById('cal-detail-content');
  const monthList=document.getElementById('month-evt-list');
  detailContent.style.display='none'; detailEmpty.style.display='none'; monthList.style.display='';
  
  if(!events){monthList.innerHTML='<div style="color:var(--muted);font-size:.75rem;padding:4px 0;">불러오는 중...</div>';return;}
  const now=new Date();
  const todayNum=parseInt(`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`);
  const upcoming=events.filter(e=>parseInt(e.date)>=todayNum).slice(0,10);
  if(!upcoming.length){monthList.innerHTML='<div style="color:var(--muted);font-size:.75rem;padding:4px 0;">이번 달 남은 학사일정이 없습니다.</div>';return;}
  monthList.innerHTML='';
  upcoming.forEach(e=>{
    const d=e.date;
    const dateLabel=`${parseInt(d.slice(4,6))}/${parseInt(d.slice(6,8))}`;
    const div=document.createElement('div');div.className='month-evt-item';
    div.innerHTML=`<span class="month-evt-date">${dateLabel}</span><span class="month-evt-name ${e.isHoliday?'holiday':''}">${e.name}</span>`;
    div.onclick=()=>{
      const k=`${d.slice(0,4)}-${d.slice(4,6)}`;
      const evts=(scheduleCache[k]||[]).filter(x=>x.date===d);
      showScheduleForDate(d,evts);
    };
    monthList.appendChild(div);
  });
}

window.showScheduleForDate=function(dateStr,dayEvts,skipRerender){
  currentViewDate=dateStr;
  if(!skipRerender) renderMiniCal();

  const d=dateStr;
  const dateLabel=`${parseInt(d.slice(0,4))}년 ${parseInt(d.slice(4,6))}월 ${parseInt(d.slice(6,8))}일`;
  const notes=calNotes[dateStr]||[];

  const detailEmpty=document.getElementById('cal-detail-empty');
  const detailContent=document.getElementById('cal-detail-content');
  const monthList=document.getElementById('month-evt-list');
  detailEmpty.style.display='none'; detailContent.style.display=''; monthList.style.display='none';

  detailContent.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div class="cal-detail-date">📅 ${dateLabel}</div>
      <button onclick="clearCalDate()" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:.75rem;font-weight:600;">← 목록으로</button>
    </div>
    ${dayEvts.length
      ? `<div class="cal-evt-list">${dayEvts.map(e=>`<div class="cal-evt-item"><span class="cal-evt-dot ${e.isHoliday?'holiday':'school'}"></span><span>${e.name}</span></div>`).join('')}</div>`
      : `<div style="font-size:.75rem;color:var(--muted);margin-bottom:8px;">학사일정 없음</div>`
    }
    <div style="font-size:.75rem;font-weight:700;color:var(--muted);margin:8px 0 5px;">📌 날짜 메모</div>
    <div class="mini-note-input-row">
      <input class="mini-note-input" id="mini-note-input-${dateStr}" placeholder="메모 입력 후 Enter">
      <button class="mini-note-add-btn" id="mini-note-add-${dateStr}">추가</button>
    </div>
    <div id="mini-notes-${dateStr}">
      ${notes.length
        ? notes.map((n,i)=>`<div class="mini-note-item"><span class="mini-note-text">${n}</span><button class="mini-note-del" data-idx="${i}" data-date="${dateStr}">✕</button></div>`).join('')
        : '<div class="mini-note-empty">메모가 없습니다.</div>'
      }
    </div>
  `;
  const addBtn=document.getElementById('mini-note-add-'+dateStr);
  if(addBtn)addBtn.onclick=()=>addCalNote(dateStr);
  const noteInput=document.getElementById('mini-note-input-'+dateStr);
  if(noteInput)noteInput.addEventListener('keydown',e=>{if(e.key==='Enter')addCalNote(dateStr);});
  detailContent.querySelectorAll('.mini-note-del').forEach(btn=>{
    btn.onclick=()=>delCalNote(btn.dataset.date,parseInt(btn.dataset.idx));
  });
};

window.clearCalDate=function(){
  currentViewDate=null;
  renderMiniCal();
};

window.addCalNote=async function(dateStr){
  const input=document.getElementById('mini-note-input-'+dateStr); if(!input)return;
  const text=input.value.trim(); if(!text)return;
  if(!calNotes[dateStr])calNotes[dateStr]=[];
  calNotes[dateStr].push(text); input.value='';
  await saveCalNotes();
};
window.delCalNote=async function(dateStr,idx){
  if(!calNotes[dateStr])return;
  calNotes[dateStr].splice(idx,1);
  if(!calNotes[dateStr].length)delete calNotes[dateStr];
  await saveCalNotes();
};
function renderMiniCalDots(){
  document.querySelectorAll('.mini-cal-cell').forEach(cell=>{
    const d=cell.querySelector('.mini-day'); if(!d)return;
    const dayNum=parseInt(d.textContent); if(isNaN(dayNum))return;
    const dateStr=`${miniCalYear}${String(miniCalMonth).padStart(2,'0')}${String(dayNum).padStart(2,'0')}`;
    cell.classList.toggle('has-memo',(calNotes[dateStr]||[]).length>0);
  });
}

// ── 📝 학생 기록 관리 (클래스 탭별 분리) ──
let currentStudentId = null;
let currentStudentName = "";
let unsubscribeRecords = null;
let unsubscribeStudents = null;

// Firestore 컬렉션 경로: 탭 ID별 분리
function studentsCol(tabId) { return `class_students/${tabId}/list`; }
function studentRecordsCol(tabId, studentId) { return `class_students/${tabId}/list/${studentId}/records`; }

// 💡 반/번호 → 문서 ID 생성 규칙 통일 (엑셀 업로드 · 수동 추가 공통 사용)
function makeStudentDocId(classNum, number) {
  return classNum
    ? `${String(classNum).padStart(2,'0')}-${String(number).padStart(2,'0')}`
    : String(number).padStart(2, '0');
}

// 특정 탭의 학생 목록 구독
function subscribeStudents(tabId) {
  if (unsubscribeStudents) { unsubscribeStudents(); unsubscribeStudents = null; }

  const container = document.getElementById('student-items');
  const clearBtn = document.getElementById('btn-clear-students');
  container.innerHTML = '<div class="memo-empty">불러오는 중...</div>';

  unsubscribeStudents = onSnapshot(collection(db, studentsCol(tabId)), snap => {
    container.innerHTML = '';
    if (snap.empty) {
      container.innerHTML = '<div class="memo-empty">등록된 학생이 없습니다.<br>NEIS 명렬을 업로드해주세요.</div>';
      clearBtn.style.display = 'none';
      return;
    }
    clearBtn.style.display = 'block';
    const list = [];
snap.forEach(d => list.push({ id: d.id, ...d.data() }));
// 💡 반이 있으면 반→번호 순, 없으면 번호 순으로 정렬
list.sort((a, b) => (a.classNum || 0) - (b.classNum || 0) || a.number - b.number);
list.forEach(s => {
  const div = document.createElement('div');
  div.className = `student-item ${currentStudentId === s.id ? 'active' : ''}`;
  div.id = `stud-${s.id}`;
  // 💡 반 정보가 있으면 "8/16" 형식, 없으면 기존 "16번" 형식
  const label = s.classNum
    ? `${s.classNum}/${String(s.number).padStart(2,'0')}`
    : `${String(s.number).padStart(2,'0')}번`;
  div.innerHTML = `
    <span><strong>${label}</strong> ${s.name}</span>
    <span style="display:flex; align-items:center; gap:6px;">
      <button class="memo-del" onclick="deleteStudentManually(event, '${s.id}', '${s.name.replace(/'/g,"\\'")}')" title="학생 삭제">✕</button>
      <span>❯</span>
    </span>
  `;
  div.addEventListener('click', (e) => {
    if (e.target.closest('.memo-del')) return; // 삭제 버튼 클릭 시 학생 선택 방지
    selectStudent(s.id, s.name, s.number, s.classNum);
  });
  container.appendChild(div);
});
  });
}

// NEIS 명렬 엑셀 업로드 (현재 탭으로)
document.getElementById('excel-file').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
reader.onload = async function(evt) {
    const data = new Uint8Array(evt.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    let headerIdx = -1;
    let numColIdx = -1;
    let nameColIdx = -1;
    let banNumColIdx = -1; // 💡 교과 세특 양식용 '반/번호' 열 추적 변수 추가
    
    // 1. 헤더 위치 탐색 (담임용 명렬표와 교과 세특 양식 둘 다 지원)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      numColIdx = row.findIndex(c => String(c).trim() === '번호');
      nameColIdx = row.findIndex(c => String(c).trim() === '성명' || String(c).trim() === '이름');
      banNumColIdx = row.findIndex(c => String(c).trim() === '반/번호'); // 💡 '반/번호'가 있는지 검사
      
      // '번호와 성명'을 찾았거나, 혹은 '반/번호와 성명'을 찾았다면 헤더 행으로 확정
      if ((numColIdx !== -1 && nameColIdx !== -1) || (banNumColIdx !== -1 && nameColIdx !== -1)) {
        headerIdx = i;
        break;
      }
    }
    
    if (headerIdx === -1) {
      alert("'번호'(또는 '반/번호')와 '성명' 열을 찾지 못했습니다.");
      return;
    }
    
    const parsedStudents = [];
    
    // 2. 학생 데이터 추출
for (let i = headerIdx + 1; i < rows.length; i++) {
  const row = rows[i];
  let num = NaN;
  let classNum = null; // 💡 반 번호 저장용 변수 추가
  const name = String(row[nameColIdx] || '').trim();
  
  // 케이스 1: 일반 담임용 명렬표 ('번호' 열 사용)
  if (numColIdx !== -1) {
    num = parseInt(row[numColIdx]);
  } 
  // 케이스 2: 교과 세특 양식 ('반/번호' 열에서 분리)
  else if (banNumColIdx !== -1 && row[banNumColIdx]) {
    const banNumStr = String(row[banNumColIdx]).trim();
    if (banNumStr.includes('/')) {
      const parts = banNumStr.split('/');
      classNum = parseInt(parts[0]); // 💡 앞쪽: 반
      num = parseInt(parts[1]);      // 뒤쪽: 번호
    }
  }
  
  if (!isNaN(num) && name && name !== 'undefined') {
    // 💡 반 정보가 있으면 "반-번호" 조합으로 고유 ID 생성 (충돌 방지)
    const docId = makeStudentDocId(classNum, num);
    parsedStudents.push({ id: docId, number: num, classNum, name });
  }
}
    
    if (!parsedStudents.length) {
      alert("파싱된 학생 정보가 없습니다.");
      return;
    }
    
    const tabLabel = classTabs.find(t => t.id === currentClassTabId)?.label || currentClassTabId;
    if (await customConfirm(`[${tabLabel}] 탭에 ${parsedStudents.length}명을 등록할까요?\n(기존 명렬이 덮어씌워집니다.)`)) {
     const batch = writeBatch(db);
parsedStudents.forEach(s => {
  batch.set(doc(db, studentsCol(currentClassTabId), s.id), {
    number: s.number,
    classNum: s.classNum || null, // 💡 반 정보도 함께 저장
    name: s.name
  });
});
      
      batch.commit()
        .then(() => alert("명렬 등록이 완료되었습니다."))
        .catch(() => alert("Firestore 권한 오류가 발생했습니다."));
    }
    
    // 💡 다음 업로드를 위해 파일 선택을 초기화하는 원래 코드 유지
    e.target.value = '';
  };
  // 👆 여기까지(reader.onload 끝) 수정이 완료됩니다.

  reader.readAsArrayBuffer(file);
});
document.getElementById('btn-clear-students').onclick = async function() {
  const tabLabel = classTabs.find(t => t.id === currentClassTabId)?.label || currentClassTabId;
  if (!(await customConfirm(`[${tabLabel}] 탭의 학생 명렬을 완전히 초기화하시겠습니까?\n(삭제 후 복구가 불가능합니다.)`))) return;
  try {
    const snap = await getDocs(collection(db, studentsCol(currentClassTabId)));
    if (snap.empty) { alert('삭제할 학생 데이터가 없습니다.'); return; }
    // Firestore writeBatch는 최대 500건 — 대부분 학급은 50명 이하이므로 1회 배치로 충분
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    currentStudentId = null;
    document.getElementById('record-empty-notice').style.display = 'flex';
    document.getElementById('record-main-panel').style.display = 'none';
    alert(`[${tabLabel}] 학생 명렬이 초기화되었습니다.`);
  } catch(e) {
    alert('초기화 중 오류가 발생했습니다: ' + e.message);
  }
};

// 학생 선택
function selectStudent(id, name, number, classNum) {
  currentStudentId = id;
  currentStudentName = name;
  document.querySelectorAll('.student-item').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`stud-${id}`);
  if (target) target.classList.add('active');
  document.getElementById('record-empty-notice').style.display = 'none';
  document.getElementById('record-main-panel').style.display = 'block';
  // 💡 반 정보 유무에 따라 표시 형식 분기
  const label = classNum
    ? `${classNum}/${String(number).padStart(2,'0')} ${name}`
    : `${id}번 ${name}`;
  document.getElementById('selected-student-name').textContent = label;
  document.getElementById('record-date').value = todayStr();
  document.getElementById('record-content').value = '';
  if (unsubscribeRecords) unsubscribeRecords();
  unsubscribeRecords = onSnapshot(collection(db, studentRecordsCol(currentClassTabId, id)), snap => {
    const box = document.getElementById('record-items');
    box.innerHTML = '';
    if (snap.empty) {
      box.innerHTML = '<div class="memo-empty">아직 누적된 관찰/상담 내역이 없습니다.<br>첫 기록을 작성해보세요.✏️</div>';
      return;
    }
    const recs = [];
    snap.forEach(d => recs.push({ id: d.id, ...d.data() }));
    recs.sort((a, b) => new Date(b.date + ' ' + (b.time||'00:00')) - new Date(a.date + ' ' + (a.time||'00:00')));
    recs.forEach(r => {
      const card = document.createElement('div');
      card.className = 'record-card';
      card.innerHTML = `
        <div class="record-meta">
          <div>
            <span class="record-badge">${r.category}</span>
            <span style="margin-left:6px; font-weight:600;">${r.date}</span>
          </div>
          <button class="memo-del" onclick="deleteStudentRecord('${r.id}')" title="삭제">✕</button>
        </div>
        <div class="record-content-text">${r.content}</div>
      `;
      box.appendChild(card);
    });
  });
}
window.selectStudent = selectStudent;

// ── 학생 수동 추가 ──
window.openAddStudentModal = function() {
  document.getElementById('add-student-class').value = '';
  document.getElementById('add-student-number').value = '';
  document.getElementById('add-student-name').value = '';
  document.getElementById('add-student-modal').classList.add('show');
};
window.closeAddStudentModal = function() {
  document.getElementById('add-student-modal').classList.remove('show');
};
window.confirmAddStudent = async function() {
  const classNumRaw = document.getElementById('add-student-class').value.trim();
  const numberRaw = document.getElementById('add-student-number').value.trim();
  const name = document.getElementById('add-student-name').value.trim();

  const number = parseInt(numberRaw);
  const classNum = classNumRaw ? parseInt(classNumRaw) : null;

  if (isNaN(number) || !name) {
    alert('번호와 이름은 필수입니다.');
    return;
  }

  const docId = makeStudentDocId(classNum, number);

  try {
    const existing = await getDoc(doc(db, studentsCol(currentClassTabId), docId));
    if (existing.exists()) {
      const label = classNum ? `${classNum}/${number}` : `${number}번`;
      if (!(await customConfirm(`이미 등록된 ${label} 학생(${existing.data().name})이 있습니다.\n덮어쓸까요?`))) {
        return;
      }
    }
    await setDoc(doc(db, studentsCol(currentClassTabId), docId), {
      number, classNum, name
    });
    closeAddStudentModal();
  } catch (e) {
    alert('추가 중 오류가 발생했습니다: ' + e.message);
  }
};

// ── 학생 수동 삭제 ──
window.deleteStudentManually = async function(event, studentId, studentName) {
  event.stopPropagation(); // 부모 div의 클릭(학생 선택) 이벤트 방지
  if (!(await customConfirm(`${studentName} 학생을 명렬에서 삭제할까요?\n(상담 기록은 별도로 남아있습니다.)`))) return;
  try {
    await deleteDoc(doc(db, studentsCol(currentClassTabId), studentId));
    if (currentStudentId === studentId) {
      currentStudentId = null;
      document.getElementById('record-empty-notice').style.display = 'flex';
      document.getElementById('record-main-panel').style.display = 'none';
    }
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + e.message);
  }
};

async function addStudentRecord() {
  if (!currentStudentId) return;
  const date = document.getElementById('record-date').value;
  const category = document.getElementById('record-category').value;
  const content = document.getElementById('record-content').value.trim();
  if (!content) { alert("관찰 피드백 텍스트를 입력해 주세요."); return; }
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  try {
    await addDoc(collection(db, studentRecordsCol(currentClassTabId, currentStudentId)), {
      date, time: timeStr, category, content, stamp: now.getTime()
    });
    document.getElementById('record-content').value = '';
  } catch(e) { alert("Firestore 저장 중 오류가 발생했습니다."); }
}
window.addStudentRecord = addStudentRecord;

async function deleteStudentRecord(recId) {
  if (!(await customConfirm("해당 관찰 내역을 삭제하시겠습니까?"))) return;
  try {
    await deleteDoc(doc(db, studentRecordsCol(currentClassTabId, currentStudentId), recId));
  } catch(e) { alert("삭제 실패"); }
}
window.deleteStudentRecord = deleteStudentRecord;

// ── 반별 학생 관찰기록 일괄 엑셀 다운로드 ──
async function downloadClassRecordsExcel() {
  const btn = document.getElementById('btn-download-records');
  const tabId = currentClassTabId;
  const tabLabel = classTabs.find(t => t.id === tabId)?.label || tabId;

  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 다운로드 준비 중...'; }

  try {
    // 1. 현재 반의 학생 명렬 가져오기
    const studentsSnap = await getDocs(collection(db, studentsCol(tabId)));
    if (studentsSnap.empty) {
      alert(`'${tabLabel}' 반에 등록된 학생이 없습니다.`);
      return;
    }
    const students = [];
    studentsSnap.forEach(d => students.push({ id: d.id, ...d.data() }));
    students.sort((a, b) => (a.classNum || 0) - (b.classNum || 0) || (a.number || 0) - (b.number || 0));

    // 2. 학생별 관찰 기록 전부 가져오기 (오래된 순으로 정렬)
    let maxRecordCount = 0;
    const studentRows = [];
    for (const s of students) {
      const recSnap = await getDocs(collection(db, studentRecordsCol(tabId, s.id)));
      const recs = [];
      recSnap.forEach(d => recs.push({ id: d.id, ...d.data() }));
      recs.sort((a, b) => (a.stamp || 0) - (b.stamp || 0));
      if (recs.length > maxRecordCount) maxRecordCount = recs.length;
      studentRows.push({ student: s, records: recs });
    }

    // 3. 헤더 구성: 반 / 번호 / 이름 / 관찰 내용1 / 관찰 내용2 / ...
    const header = ['반', '번호', '이름'];
    for (let i = 1; i <= maxRecordCount; i++) header.push(`관찰 내용 ${i}`);

    // 4. 데이터 행 구성
    const aoa = [header];
    studentRows.forEach(({ student, records }) => {
      const row = [
        student.classNum || '',
        student.number || '',
        student.name || ''
      ];
      records.forEach(r => {
        const dateStr = r.date || '';
        const catStr = r.category || '';
        const contentStr = r.content || '';
        row.push(`[${dateStr}${catStr ? ' ' + catStr : ''}] ${contentStr}`.trim());
      });
      aoa.push(row);
    });

    // 5. 엑셀 파일 생성 및 다운로드
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    // 열 너비 대략 지정 (반/번호/이름 좁게, 관찰내용은 넓게)
    worksheet['!cols'] = [
      { wch: 6 }, { wch: 6 }, { wch: 10 },
      ...Array(maxRecordCount).fill({ wch: 40 })
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, tabLabel.substring(0, 31));

    const todayForFile = todayStr();
    XLSX.writeFile(workbook, `${tabLabel}_학생기록_${todayForFile}.xlsx`);
  } catch (e) {
    alert('엑셀 다운로드 중 오류가 발생했습니다: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}
window.downloadClassRecordsExcel = downloadClassRecordsExcel;

window.openGemsWindow = function() {
  const gemsUrl = "https://gemini.google.com/gem/1MJumdSg_ypiivyg8-jE3PGV8jPavmkL0?usp=sharing";
  const popupWidth = 480;
  const popupHeight = window.screen.availHeight - 100;
  const popupLeft = window.screen.availWidth - popupWidth - 20;
  window.open(gemsUrl, 'GemsMultiWindow', `width=${popupWidth},height=${popupHeight},left=${popupLeft},top=50,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`);
};

// ─────────────────────────────────────────────────────────
// 📌 화면 비율(%) 대응 및 안전한 이벤트 바인딩 스티커 메모 로직
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 📌 [에러 완벽 교정] 화면 비율(%) 대응 및 안전한 스티커 메모 로직
// ─────────────────────────────────────────────────────────

const stickyColRef = collection(db, "sticky_notes"); 

// 1. 실시간 리스너 및 버튼 이벤트 연결
function initStickyNotes() {
  // 상단 [+] 버튼 연동 (타이밍 에러 방지)
  const addBtn = document.getElementById('add-sticky-btn');
  if (addBtn) {
    addBtn.onclick = null; // 기존 중복 바인딩 방지
    addBtn.addEventListener('click', () => {
      addStickyNote();
    });
  }

  // Firestore 실시간 감시 시작
  onSnapshot(stickyColRef, (snapshot) => {
    const container = document.getElementById('tab-dashboard'); 
    const notesContainer = document.getElementById('sticky-notes-container');
    if (!container || !notesContainer) return;
    
    notesContainer.innerHTML = ''; 

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const id = docSnap.id;
      
      const noteEl = document.createElement('div');
      noteEl.className = 'sticky-note';
      
      // DB에 저장된 % 값을 현재 창 크기에 맞는 픽셀 비율로 복원
      const percentX = (data.x > 100) ? 20 : (data.x || 20);
      const percentY = (data.y > 100) ? 30 : (data.y || 30);
      
      noteEl.style.left = percentX + "%";
      noteEl.style.top = percentY + "%";
      noteEl.setAttribute('data-id', id);

      // 인라인 onclick을 모두 제거한 내부 구조 생성
      noteEl.innerHTML = `
        <div class="sticky-header">
          <span>메모장</span>
          <button class="sticky-del-btn">X</button>
        </div>
        <textarea class="sticky-textarea" placeholder="내용을 입력하세요.">${data.content || ''}</textarea>
      `;

      // 자바스크립트 내부에서 삭제 버튼 이벤트 다이렉트 바인딩
      const delBtn = noteEl.querySelector('.sticky-del-btn');
      delBtn.addEventListener('click', () => {
        deleteStickyNote(id);
      });

      // 자바스크립트 내부에서 텍스트 변경 이벤트 다이렉트 바인딩
      const textarea = noteEl.querySelector('.sticky-textarea');
      textarea.addEventListener('change', (e) => {
        updateStickyText(id, e.target.value);
      });

      // 드래그앤드롭 기능 적용 후 화면에 렌더링
      makeElementDraggable(noteEl);
      notesContainer.appendChild(noteEl);
    });
  });
}

// 2. 새 메모 추가 (초기 위치를 % 비율로 설정)
async function addStickyNote() {
  try {
    await addDoc(stickyColRef, {
      content: "",
      x: 20, // 가로 20% 지점
      y: 30, // 세로 30% 지점
      createdAt: new Date().getTime()
    });
  } catch (e) {
    console.error("생성 실패:", e);
  }
}

// 3. 내용 수정 자동 저장
async function updateStickyText(id, value) {
  try {
    const docRef = doc(db, "sticky_notes", id);
    await updateDoc(docRef, { content: value });
  } catch (e) {
    console.error("저장 실패:", e);
  }
}

// 4. 메모 삭제
async function deleteStickyNote(id) {
  if (!(await customConfirm("삭제하시겠습니까?"))) return;
  try {
    const docRef = doc(db, "sticky_notes", id);
    await deleteDoc(docRef);
  } catch (e) {
    console.error("삭제 실패:", e);
  }
}

// 5. 드래그 기능 구현 (% 값 변환 포함)
function makeElementDraggable(elmnt) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  const header = elmnt.querySelector('.sticky-header');
  
  if (header) {
    header.onmousedown = dragMouseDown;
  } else {
    elmnt.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }

  async function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;

    const id = elmnt.getAttribute('data-id');
    const container = document.getElementById('tab-dashboard');
    if (!container) return;

    // 현재 픽셀 좌표를 부모 컨테이너 크기 기준 백분율(%)로 변환 계산
    const parentWidth = container.clientWidth;
    const parentHeight = container.clientHeight;

    const finalXPercent = Math.min(Math.max((elmnt.offsetLeft / parentWidth) * 100, 0), 90).toFixed(1);
    const finalYPercent = Math.min(Math.max((elmnt.offsetTop / parentHeight) * 100, 0), 90).toFixed(1);

    try {
      const docRef = doc(db, "sticky_notes", id);
      await updateDoc(docRef, { 
        x: parseFloat(finalXPercent), 
        y: parseFloat(finalYPercent) 
      });
    } catch (e) {
      console.error("위치 저장 실패:", e);
    }
  }
}

// 6. 페이지 로드 완수 시 구동 시작
(() => {
  initStickyNotes();
})(); // (defer 스크립트라 DOM은 이미 준비됨 — DOMContentLoaded 대기 제거)
// ─────────────────────────────────────────────────────────
// 💡 모듈 스코프 탈출을 위해 전역(window) 객체에 함수 등록
// ─────────────────────────────────────────────────────────
window.addStickyNote = addStickyNote;
window.deleteStickyNote = deleteStickyNote;
window.updateStickyText = updateStickyText;

// 7. HTML 로드가 끝나면 스티커 노트 실시간 동기화 시작
(() => {
  initStickyNotes();
})(); // (defer 스크립트라 DOM은 이미 준비됨 — DOMContentLoaded 대기 제거)

// ─────────────────────────────────────────────────────────
// 📌 ⚡ 퀵 키워드 자동 입력 및 Firestore 관리 로직
// ─────────────────────────────────────────────────────────

const kwColRef = collection(db, "quick_keywords");
const kwDocRef = doc(db, "quick_keywords", "teacher_settings"); // 단일 문서로 관리
let isKeywordEditMode = false;

// 1. 키워드 기능 초기화 및 실시간 동기화
function initQuickKeywords() {
  const viewModeEl = document.getElementById('keyword-view-mode');
  const editModeEl = document.getElementById('keyword-edit-mode');
  const rawInputEl = document.getElementById('keyword-raw-input');
  const toggleBtn = document.getElementById('kw-toggle-btn');
  const saveBtn = document.getElementById('kw-save-btn');
  const recordTextarea = document.getElementById('record-content'); // 관찰 기록장 입력창

  if (!viewModeEl || !editModeEl || !rawInputEl || !toggleBtn || !saveBtn) return;

  // 기본 키워드 세트 (DB에 데이터가 없을 때 표시할 물리/통합과학 샘플)
  const defaultKeywords = [
    "역학적 시스템에 대한 분석 능력이 우수함.",
    "전자기 유도 실험에 주도적으로 참여하여 가설을 검증함.",
    "물리학 이론의 개념 이해도가 높고 질문이 날카로움.",
    "수업 집중도가 뛰어나고 과제 수행 결과물이 정교함.",
    "조원들과 협력하여 실험 기구를 안전하게 다룸.",
    "스스로 탐구 주제를 설정하고 해결하려는 의지가 돋보임."
  ];

  // DB 실시간 감시
  onSnapshot(kwDocRef, (docSnap) => {
    let keywordsArray = defaultKeywords;

    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.list && Array.isArray(data.list) && data.list.length > 0) {
        keywordsArray = data.list;
      }
    }

    // [평소 모드 화면] 태그 그리기
    viewModeEl.innerHTML = '';
    keywordsArray.forEach(kw => {
      if (!kw.trim()) return;
      const tag = document.createElement('span');
      tag.className = 'keyword-tag';
      tag.textContent = kw;
      
      // ✨ 핵심: 클릭 시 입력창(textarea)에 한 칸 띄고 자동으로 글자 추가 기능
      tag.addEventListener('click', () => {
        if (!recordTextarea) return;
        const currentVal = recordTextarea.value;
        // 기존 내용이 있으면 공백을 하나 두고 덧붙임
        if (currentVal.trim() === "") {
          recordTextarea.value = kw + " ";
        } else {
          recordTextarea.value = currentVal.trim() + " " + kw + " ";
        }
        recordTextarea.focus(); // 입력 후 포커스 유지
      });
      viewModeEl.appendChild(tag);
    });

    // [수정 모드 화면] 텍스트 영역에 줄바꿈 형식으로 미리 채워두기
    rawInputEl.value = keywordsArray.join('\n');
  });

  // 토글 버튼 누를 때 (수정 <-> 보기 모드 전환)
  toggleBtn.onclick = () => {
    isKeywordEditMode = !isKeywordEditMode;
    if (isKeywordEditMode) {
      viewModeEl.style.display = 'none';
      editModeEl.style.display = 'flex';
      toggleBtn.textContent = '📁 보기 화면으로';
    } else {
      viewModeEl.style.display = 'flex';
      editModeEl.style.display = 'none';
      toggleBtn.textContent = '⚙️ 키워드 수정';
    }
  };

  // 저장 버튼 누를 때 (줄바꿈 단위로 쪼개서 Firestore에 배열로 저장)
  saveBtn.onclick = async () => {
    const rawText = rawInputEl.value;
    // 엔터(줄바꿈) 기준으로 분리하고 양끝 공백 제거 후 빈 줄은 필터링
    const newKeywordsList = rawText.split('\n')
                                   .map(item => item.trim())
                                   .filter(item => item.length > 0);

    try {
      // updateDoc은 상단에 이미 세팅되어 있으므로 바로 사용 가능합니다.
      await setDoc(kwDocRef, { list: newKeywordsList });
      
      // 저장 성공 후 평소 모드로 복귀
      isKeywordEditMode = false;
      viewModeEl.style.display = 'flex';
      editModeEl.style.display = 'none';
      toggleBtn.textContent = '⚙️ 키워드 수정';
    } catch (e) {
      console.error("키워드 저장 실패:", e);
      alert("저장에 실패했습니다.");
    }
  };
}

// 💡 스크립트 맨 아래에 있는 DOMContentLoaded 리스너 안에 초기화 함수를 얹어줍니다.
(() => {
  if (typeof initStickyNotes === 'function') initStickyNotes();
  
  // ⚡ 퀵 키워드 엔진 가동
  initQuickKeywords();
})(); // (defer 스크립트라 DOM은 이미 준비됨 — DOMContentLoaded 대기 제거)


/**
 * ⚙️ 나이스(NEIS) 기준 바이트 계산 함수 (최신 UTF-8 반영)
 * 한글 = 3바이트 / 영문, 숫자, 공백, 기본기호 = 1바이트
 */
function getNeisByteLength(str) {
  if (!str) return 0;
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode > 128) {
      bytes += 3; // 한글, 특수문자 등
    } else {
      bytes += 1; // 영문, 숫자, 공백 등
    }
  }
  return bytes;
}

// ── 바이트 화면 표시를 갱신하는 공통 함수 ──
function updateBytesDisplay(textarea, counterSpan) {
  if (!textarea || !counterSpan) return;
  const byteLength = getNeisByteLength(textarea.value);
  counterSpan.textContent = byteLength;
  
  // 1500바이트 초과 시 빨간색 경고
  if (byteLength > 1500) {
    counterSpan.style.color = 'var(--accent)';
    counterSpan.style.fontWeight = '700';
  } else {
    counterSpan.style.color = 'var(--ink)';
    counterSpan.style.fontWeight = '400';
  }
}

// 페이지 로드 후 실행
(() => {
  // 현재 코드 상의 관찰내용 textarea ID를 찾습니다.
  const recordContentInput = document.getElementById('record-content') || document.getElementById('student-obs-input');
  
  if (recordContentInput) {
    // 1. textarea 바로 밑에 바이트 표시용 div 엘리먼트 동적 삽입
    const counterDiv = document.createElement('div');
    counterDiv.id = 'obs-byte-counter';
    counterDiv.style.cssText = 'text-align: right; font-size: 0.75rem; color: var(--muted); margin-top: 4px;';
    counterDiv.innerHTML = '<span id="current-bytes">0</span> / 1500 Byte';
    
    recordContentInput.parentNode.insertBefore(counterDiv, recordContentInput.nextSibling);
    const currentBytesSpan = document.getElementById('current-bytes');
    
    // 2. 사용자가 직접 입력할 때 감지 (키보드 입력)
    ['input', 'keyup', 'change'].forEach(eventType => {
      recordContentInput.addEventListener(eventType, function() {
        updateBytesDisplay(this, currentBytesSpan);
      });
    });
    
    // ⭐ [핵심 수정] 3. 다른 학생을 클릭하여 프로그램이 글자를 바꿀 때(value 변경) 감지
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(recordContentInput, 'value', {
      get: function() {
        return descriptor.get.call(this);
      },
      set: function(val) {
        descriptor.set.call(this, val); // 원래 글자 입력 기능 수행
        updateBytesDisplay(this, currentBytesSpan); // 💡 글자가 바뀌는 순간 바이트 수 즉시 업데이트!
      }
    });

    // 최초 로드 시 한 번 정렬
    updateBytesDisplay(recordContentInput, currentBytesSpan);
  }
})(); // (defer 스크립트라 DOM은 이미 준비됨 — DOMContentLoaded 대기 제거)


// ─────────────────────────────────────────────────────────
// 🤖 GEMS AI 비서 로직 및 패널 제어 (2026 업데이트 버전)
// ─────────────────────────────────────────────────────────

// 생기부(나이스) 표준 바이트 계산 함수 (한글 3바이트, 영문/숫자/공백 1바이트, 엔터 2바이트)
function calculateGemsBytes(str) {
  if (!str) return 0;
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 10) { // 엔터(줄바꿈)
      bytes += 2;
    } else if (ch > 128) { // 한글 및 전각 문자
      bytes += 3;
    } else { // 영문, 숫자, 공백, 기본 반각 특수문자
      bytes += 1;
    }
  }
  return bytes;
}

// 1. AI 결과창 바이트 표시 갱신 함수
window.updateGemsResultBytes = function(targetByteLimit) {
  const resultBox = document.getElementById("gems-result-box");
  const counterSpan = document.getElementById("gems-result-byte-counter");
  const ratioSpan = document.getElementById("gems-byte-ratio");
  if (!resultBox || !counterSpan) return;

  const actualBytes = calculateGemsBytes(resultBox.value);
  counterSpan.textContent = actualBytes + " Byte";

  if (!ratioSpan) return;
  const limitInput = document.getElementById("gems-byte-limit");
  const target = targetByteLimit || parseInt(limitInput?.value, 10) || null;

  if (!target || actualBytes === 0) {
    ratioSpan.textContent = "";
    return;
  }
  const ratio = Math.round((actualBytes / target) * 100);
  ratioSpan.textContent = `(목표 ${target} Byte 대비 ${ratio}%)`;
  // 목표치에서 15% 이상 벗어나면 빨간색으로 경고 표시
  if (Math.abs(ratio - 100) > 15) {
    ratioSpan.style.color = "#e74c3c";
    ratioSpan.style.fontWeight = "700";
  } else {
    ratioSpan.style.color = "var(--muted)";
    ratioSpan.style.fontWeight = "400";
  }
};

// 현재 선택된 학생의 화면에 존재하는 기록 태그들을 동적으로 추출하여 드롭다운에 채워넣는 함수
window.updateGemsTagOptions = function() {
  const selectNode = document.getElementById('gems-tag-filter');
  if (!selectNode) return;
  
  // '전체 태그' 옵션 제외하고 초기화
  selectNode.innerHTML = '<option value="all">전체 태그</option>';
  
  // 대시보드 학생 기록 탭의 모든 레코드 카드에서 태그 배지(.record-badge) 추출
  const badges = document.querySelectorAll('.record-card .record-badge');
  const tags = new Set();
  
  badges.forEach(badge => {
    const tagText = badge.textContent.trim();
    if (tagText) tags.add(tagText);
  });
  
  // 추출된 유일한 태그 항목들을 드롭다운 선택지에 추가
  tags.forEach(tag => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    selectNode.appendChild(option);
  });
};

// 2. 대시보드 누적 관찰 기록 연동 및 복사 수집 함수
window.importStudentRecord = function() {
  const gemsInput = document.getElementById('gems-obs-input');
  const tagFilter = document.getElementById('gems-tag-filter').value;
  if (!gemsInput) return;
  
  // 대시보드 학생 우측 리스트에 바인딩된 모든 기록 카드 탐색
  const recordCards = document.querySelectorAll('.record-card');
  
  if (recordCards.length > 0) {
    let compiledText = [];
    
    recordCards.forEach(card => {
      const badgeNode = card.querySelector('.record-badge');
      const contentNode = card.querySelector('.record-content-text');
      
      if (contentNode) {
        const tagText = badgeNode ? badgeNode.textContent.trim() : '';
        const contentText = contentNode.textContent.trim();
        
        // 사용자가 선택한 필터 조건과 일치하거나 '전체 태그'인 경우에만 텍스트 축적
        if (tagFilter === 'all' || tagFilter === tagText) {
          if (tagFilter === 'all' && tagText) {
            compiledText.push(`[${tagText}] ${contentText}`);
          } else {
            compiledText.push(contentText);
          }
        }
      }
    });
    
    if (compiledText.length > 0) {
      gemsInput.value = compiledText.join('\n\n');
      return; // 여러 개 텍스트 취합 성공 시 처리 종료
    }
  }
  
  // 예외/하위 호환 처리: 만약 저장된 카드가 전혀 없다면 임시 작성 칸에서 글자를 긁어옴
  const dashboardInput = document.getElementById('record-content') || document.getElementById('student-obs-input');
  if (dashboardInput && dashboardInput.value.trim()) {
    gemsInput.value = dashboardInput.value;
  } else {
    alert("선택된 학생의 관찰 기록 카드를 찾지 못했거나 내용이 비어있습니다. 학생이 정상 선택되었는지 확인해 주세요.");
  }
};

// 창 열기 (열릴 때 필터 셋업 및 학생 기록 연동이 자동으로 매끄럽게 동기화됩니다)
window.openGemsPanel = function() {
  const panel = document.getElementById('gems-ai-panel');
  panel.style.display = 'flex';
  document.getElementById('gems-ai-body').style.display = 'flex';
  document.getElementById('gems-toggle-icon').textContent = '▼';
  
  // 동적으로 드롭다운 태그 옵션 빌드 후 자동 복사 실행
  window.updateGemsTagOptions();
  window.importStudentRecord();
};

// 창 닫기
window.closeGemsPanel = function(e) {
  e.stopPropagation();
  document.getElementById('gems-ai-panel').style.display = 'none';
};

// 창 접기/펴기
window.toggleGemsBody = function() {
  const body = document.getElementById('gems-ai-body');
  const icon = document.getElementById('gems-toggle-icon');
  if (body.style.display === 'none') {
    body.style.display = 'flex';
    icon.textContent = '▼';
  } else {
    body.style.display = 'none';
    icon.textContent = '▲';
  }
};

// API 설정 및 프롬프트 (선생님의 고유 키와 프롬프트 지침 데이터를 백틱 내부에 유지하세요)

const GEMS_SYSTEM_PROMPT = `너는 [2025 유초중고 생기부 AI 비서 젬스(GEMS)]이다. 너는 교육부 기재요령 점검 장학사의 시각을 가진 생기부 작성 전문가이며, 아래의 통합 지침을 절대적인 헌법으로 준수한다.



[대전제]
1. 교과세특의 경우 업로드된 pdf파일에서 교육과정 참고
2. 교육과정pdf - 프롬프트 - 교사 관찰 기록 - 글자수 점검의 순서를 엄격히 지킬 것.
3. **교육과정 PDF 활용 규칙:**

- 교육과정 PDF가 업로드된 경우, 엑셀 데이터와 별개로 PDF 전체를 읽고 해당 교과의 성취기준·핵심 개념·학습 요소를 파악합니다.

- 파악한 내용은 **내부 참고용으로만 활용**하며, 생기부 문장 작성 시 자연스럽게 녹여냅니다.

- **성취기준 코드(예: [12철학01-01])는 최종 출력 문장에 절대 표기하지 마십시오.**

- PDF 활용 방안(어떤 성취기준과 핵심 개념을 활용할지)은 헤더 분석 대화 단계에서 선생님과 함께 논의합니다.

- 교육과정 PDF가 없는 경우, 이 규칙은 적용하지 않고 기존 방식대로 작성합니다.

     
너는 [2025 유초중고 생기부 AI 비서 젬스(GEMS)]이다. 너는 교육부 기재요령 점검 장학사의 시각을 가진 생기부 작성 전문가이며, 아래의 통합 지침을 절대적인 헌법으로 준수한다.



[시스템 기동 및 파일 처리 수칙]

1. 대화 시작 전  '교육과정' 파일을 최우선 로딩하여 판단 기준으로 삼는다.


[0. 대원칙: 입체적 참조 시스템]


1. 할루시네이션 방지: 파일에 없는 수행평가나 행사는 창작하지 않는다. 정보 부족 시 사용자에게 공식 명칭을 되묻는다.
2. 교과 세특의 경우 교육과정 파일 - 프롬프트 - 글자수 참고 - 학생 기록 순으로 읽고 작성한다.



[1. 학교급별 교육과정 적용 로직 (엄수)]


나. 중학교 (과정 중심):

- 1학년(자유학기): 일제식 지필평가 지양, 과정 중심 평가 서술. 학교폭력 조치는 '조치상황 관리'란에 일원화.

다. 고등학교 (대입/진로 중심):

- 1학년(22개정/고교학점제): 최소 성취수준 미달 예상 시 '보충지도 프로그램 이수' 내용 포함하여 기술.

- 2~3학년(15개정): 대입 연계. [동기(Why) → 심화탐구(How Deep) → 확장(So What)]의 3단계 심화 구조 적용. 서울대 등 가이드북의 '지적 호기심' 반영.

라. 직업계고 (실무 중심):

- NCS 기반 "조작할 수 있음", "수행함", "해결함" 등 현장 실무 역량 기술.

마. 학교자율시간 (2025 신설):

- 학교 개설 '과목'은 세특에, 창체 연계 '활동'은 자율/진로 특기사항에 활동명을 포함하여 기재.



[2. 작성 기본 규칙 및 금지어 가이드 (Tone & Safety)]



1. 문체 원칙 (Style & Objectivity):

   - 모든 문장은 명사형 종결어미(~함, ~임)로 끝낸다. ("했다", "하였다" 금지)

   - "탁월함, 뛰어남, 우수함" 등 교사의 주관적 평가어 사용을 금지하며, 대신 **구체적 행동과 변화(Fact)**로 우수성을 입증한다.

   - "이해함, 느낌" 등 학생 입장에서 서술된 평가어 사용을 금지한다.

   - 여러 활동이 입력되는 경우 여러개의 결과를 내는 것이 아니라 통합하여 하나의 결과만을 출력한다.



2. 절대 입력 금지 (Red Flag) ⭐Strict:

   - 사교육 유발: 교외 수상, 논문(학회지), 도서 출간, 발명 특허, 해외 어학연수, 영재교육원, 영어.

   - 구체적 수치: 석차(1등/전교 10등), 등급(1등급), 원점수(98점), 관련 대학/기관명.

   - 부모 정보: 부모의 직업, 지위, 사회 경제적 배경 암시 금지.



3. "모의고사/수능" 자동 순화 (Auto-Sanitizing) ⭐Critical:

   - 사용자 입력(Raw): "모의고사", "학평", "수능 기출", "3월 학력평가", "문제집(쎈/정석)", "1등급 목표".

   - AI 처리 원칙: 해당 단어를 **즉시 삭제**하고, 그 안에 담긴 **[학습 주제]**와 **[탐구 역량]**으로 변환하여 기술한다.

   - (예: "모의고사 빈칸 문제 틀림" → "문맥을 통해 추상적 어휘의 의미를 추론하는 논리적 독해력을 기름.")

   - (예: "3월 학평 30번 미적분 오답 정리" → "고난도 함수 추론 문제 해결 과정에서 도함수의 활용 개념을 재정립함.")



4. 어휘 필터 (Vocabulary Guard):

   - 사설 서비스명 순화: 유튜브→동영상 플랫폼, 카카오톡→메신저, 네이버→포털사이트/검색엔진.

   - 비속어/은어: 학생이 입력한 구어체나 비속어는 교육적인 표준어로 자동 변환한다.



5. 개인정보 보호 (Privacy Masking):

   - 학생 실명, 전화번호, 주소 등은 출력 시 반드시 'OOO', '위 학생' 등으로 마스킹 처리한다.




[2-5. 외국어 및 전문용어 표기 '안전 괄호' 프로토콜 (Safety-Parenthesis)]

1. 대원칙 (Hangeul First): 

   - 학교생활기록부는 "한글 기재"가 원칙이므로, 영문/외국어 단독 표기를 엄격히 금지한다.

   - 불가피한 전문 용어(Key terms), 고유 명사, 작품명 등은 반드시 [국문 용어(영문 원어)] 형태로 병기하여 기재 규정을 준수한다.



2. 표기 양식 (3단 필터):

   - (❌ 금지) 영문 단독: "High-context culture를 분석하고..." (감사 지적 대상)

   - (🔺 주의) 영문 주도: "High-context culture(고맥락 문화)를 분석하고..." (가독성 저하)

   - (🔺 주의) 국문 주도: "고맥락 문화(High-context culture)를 분석하고..." (안전)
   - (✅ 권장) 국문 단독: "고맥락 문화를 분석하고..." (규정 준수 및 안전)



3. 금지 사항 (Red Line):

   - 일반 명사(Apple, Book, Friend)의 영문 병기 금지.

   - 영어 문장 전체(I have a dream...)의 원문 기재 절대 불가. (단어/구 단위만 허용)



4. 교과별 적용 예시:

   - [영어] Low-context culture → 저맥락 문화(Low-context culture)

   - [정보] Python, C-lang → 파이썬(Python), C언어(C-lang)

   - [과학] ATP, DNA → 아데노신 삼인산(ATP), 디엔에이(DNA)

   - [예술] Pop Art, Cubism → 팝아트(Pop Art), 입체파(Cubism)





[3. 교과 세특 작성 심화 가이드]

1. 구조: [단원/동기] → [탐구 활동/과정] → [결과/산출물] → [성장/변화].

2. 고등 심화: 단순 나열을 지양하고, 교과 지식을 자신의 진로(전공)와 연결하거나, 심층 자료(논문/통계)를 분석한 과정을 구체화한다.

3. 예체능: "잘 그린다/부른다" 대신 [이론적 분석] + [실기 적용] 구조로 기술. (예: 운동 역학 원리를 적용하여 슛 자세를 교정함)

4. 행정 용어 소거: 출력물에 '1학기', '논술형', '수행평가', '지필평가' 등의 용어를 포함하지 않고 "수업 시간에", "탐구 과정에서"로 자연스럽게 변환한다.





[3-1. 교과(세특) 및 특수·다문화 통합 가이드 (All-in-One)]



가. 중·고등학교 일반교과 (Academic & Analytical) ⭐NEW

   - 원칙: 단순한 '학습 내용 나열'을 지양하고, 학생의 **'탐구 역량', '비판적 사고력', '심화 학습 과정'**을 구체적으로 기술한다.

   - 구성: [동기] → [심화 탐구 활동] → [결과 및 변화] → [전공 적합성/학업 역량]

   - 예시: "수행평가(보고서) 작성 중 'OOO' 개념에 의문을 품고 추가 자료를 조사하여..."





[3-4. 전문상담교사 및 담임교사(상담활동) 통합 가이드 (Dual Mode)]

※ 전문상담교사의 상담일지뿐만 아니라, 담임교사의 '학생 상담록(생활지도)' 작성 시에도 동일하게 적용한다.



가. [모드 A] 학교생활기록부(생기부) 작성 (Growth & Positive)

   - 적용 대상: 자율/진로/동아리 특기사항, 행발 등 학생의 성장을 기록하는 공식 문서.

   1) 절대 금지 사항 (Privacy Shield):

      학생의 **내밀한 상담 내용(가정폭력, 이혼, 우울증, 자해, 구체적인 병명, 친구 관계의 갈등 세부 내용)**은 생기부에 절대 기재하지 않는다.

   2) 작성 원칙 (Activity-Based):

      고민의 '내용'이 아니라, 이를 극복하기 위해 참여한 **'활동'**과 **'성장'** 위주로 긍정적으로 기술한다.

      - (예: "우울증 상담 받음"(X) → "정서 조절 프로그램에 참여하여 자신의 감정을 긍정적으로 표현하는 법을 익힘"(O))



나. [모드 B] 상담일지(행정/관찰) 작성 (Dry & Objective)

   - 적용 대상: 나이스(NEIS) 상담기록, 담임교사 학생상담록, 내부 결재용 상담 대장.

   1) 톤 앤 매너 (Tone & Manner):

      - 미화된 표현(슬기롭게, 아름답게)을 배제하고, **제3자적 관찰자 시점**에서 **건조하고(Dry) 명확한 행정 용어**를 사용한다.

   2) 민감정보 순화 (Safety Protocol):

      - 실명 금지: 학생/가족의 실명은 '내담자', '부(父)', '모(母)', '교우', '반 학생' 등으로 변경한다.

      - 자극적 묘사 순화: 구체적 폭력/자해 방법 등은 **추상적 행정 용어**로 변환한다.

   3) 필수 종결 어미:

      - 진술: **~라고 호소함, ~라고 진술함, ~라고 언급함**

      - 관찰: **~한 것으로 관찰됨, ~한 양상을 보임, ~한 것으로 파악됨**

      - 조치: **~하도록 조력함, ~할 것을 지도함, ~하기로 협의함**




[3-10. 특목고(과고/외고/국제고) 및 자사고 심화 작성 가이드]



가. 작성의 핵심: 학문적 수월성(Academic Excellence)

일반적인 '이해함', '학습함' 수준을 넘어, 대학 학부 수준의 **'심화 개념 적용'**, **'비판적 분석'**, **'대안 제시'** 역량을 기술한다.



나. 학교 유형별 맞춤 전략:

1) 과학고/영재학교 (Science & Math):

   - 실험의 성공 여부보다 **'실험 설계(Variable Control)'**, **'오차 원인 분석(Error Analysis)'**, **'이론적 한계 극복'** 과정을 기술한다.

   - 전문 교과(고급물리학, 고급화학 등)의 경우, 단순 문제 풀이가 아닌 **'실생활 현상의 수학적 모델링'**이나 **'자신만의 가설 검증'** 내용을 포함한다.

2) 외고/국제고 (Global & Humanities):

   - 원서(Original Text) 강독 능력을 바탕으로, 번역본이 아닌 **'원문 텍스트 분석'**을 통한 저자의 의도 파악 및 비판적 수용 과정을 기술한다.

   - 국제 이슈(환경, 인권, 외교)에 대해 단순한 현상 나열이 아닌, **'다각적 관점(정치/경제/문화)에서의 분석'**과 **'실질적인 해결책 제안'**을 강조한다.

3) 자사고 (Self-Directed):

   - 학교의 다양한 특색 프로그램(과제연구, 학술제)과 교과 수업을 연결하여, **'지적 호기심의 확장 과정(꼬리에 꼬리를 무는 탐구)'**을 유기적으로 서술한다.



다. 고급 어휘 사용 (Advanced Vocabulary):

학문적 깊이를 드러내기 위해 **'메타인지', '학제간 융합', '변증법적 추론', '통계적 유의성 검증'** 등 교과 특성에 맞는 전문 용어를 적절히 활용한다.





[4. 창의적 체험활동 작성 가이드]

1. 자율/진로: 학교 특색 활동, 범교과 학습(안전/인성/AI윤리) 내용을 녹여낸다.

2. 동아리: 활동의 단순 나열보다 학생의 '역할(기여도)'과 '협력 태도'를 강조한다.

3. 봉사: 실적만 입력하고 특기사항은 기재하지 않음(고등, 중1). 행동특성에 봉사 태도를 녹여냄.





[5. 행동특성 및 종합의견 (Bidirectional)]

1. 정방향: 사용자의 누가기록(날짜/사건)을 입력받아 종합적인 행발 문장으로 변환.

2. 역방향: 키워드(배려, 나눔) 요청 시, 문장 생성과 함께 이를 뒷받침할 '가상의 누가기록 예시'도 함께 제안.

3. 성장 샌드위치: 단점 기술 시 [노력/과정 → 아쉬움(완곡) → 긍정적 변화 가능성] 순서로 배치.



[7. 출력 형식 및 데이터 생성 (Output Protocol)]

1. 포맷: 모든 결과물은 줄글 형태로 작성한다.

2. 내용: [세부능력 및 특기사항] 열 작성 시 **[의사소통], [문제해결]**과 같은 인위적인 소제목(Header)이나 대괄호 표기를 절대 사용하지 않는다. 대신 해당 역량이 문장 속에 자연스럽게 녹아들도록 '완벽한 줄글(Narrative)' 형태로 서술한다.

3. 다른 문장은 말하지 않고 오직 생활기록부 결과물만 출력하여 보여준다.



[9.] 독창성 및 안전성 확보 (AI 탐지 회피) 원칙



GEMS는 AI 탐지 회피 및 글의 독창성 극대화를 위해, 사용자가 제공한 '날것의 정보'를 바탕으로 아래의 기술적 원칙을 준수하여 문장을 생성한다.



1.  **고유성 주입:** 사용자가 입력한 '날것의 관찰 메모(고유명사, 특정 일화)'를 문장 중간에 필수적으로 삽입하여 글의 고유성(인간의 지문)을 확보해야 한다. (허위 정보 생성 절대 금지)

2.  **문장 분절:** 문장을 통째로 길게 연결하지 말고, 2~3개의 짧은 호흡으로 분절하여 구성한다.

3.  **구조 변환:** 문장 구조의 다양성을 위해 수동태/능동태, 명사형/서술형 종결을 의도적으로 교차 사용하여 AI 패턴 예측을 회피한다.

4.  **접속어 교체:** 흔하게 사용되는 접속사(예: '뿐만 아니라', '또한', '이에')는 다양한 대체어(예: '더불어', '이 과정에서', '나아가', '결과적으로')로 변환하여 사용함으로써 유사도를 낮춘다.

5.  **내용 중심:** '열심히', '성실하게' 등 감정적 수식어는 배제하고, 학생이 '무엇을 했는지'에 해당하는 구체적인 동사와 성과를 중심으로 문장을 구성한다.

6.  **역량 강조:** 평가 기준은 '우수하다' 대신 '탐구적 사고를 정립함', '논리적 분석 능력을 증명함' 등 교육적 역량 중심으로 기술한다.





[10. 중복 방지: 7대 프리즘 (7-Prisms)]

다수 학생 생성 요청 시 다음 7가지 관점을 교차 적용하여 중복을 방지한다.

①학업심화형 ②과정주도형 ③문제해결형 ④소통협력형 ⑤융합창의형 ⑥진로연계형 ⑦실천윤리형.`; 


const GEMS_REFERENCE_DATA = `

뉴턴의 중력 법칙을 학습하며 지표면 근처의 중력 퍼텐셜 에너지와 우주 공간에서의 중력 퍼텐셜 에너지 공식의 형태가 다른 이유에 대해 의문을 품고 탐구 보고서를 작성함. 두 공식의 차이가 중력의 크기가 일정하다고 가정하는지, 혹은 거리에 따라 변한다고 가정하는지에 따라 달라진다는 점을 명확히 분석함. 나아가 만유인력이 거리의 제곱에 반비례하는 변하는 힘이라는 사실로부터 일-에너지 정리를 적용하여 우주 공간에서의 중력 퍼텐셜 에너지 공식을 수학적으로 유도해내는 과정을 통해 물리 개념을 논리적으로 증명하는 탐구 역량을 보여줌. 이러한 이론적 이해에 그치지 않고, 학습한 개념을 실제 현상에 적용하여 검증하는 과학적 태도를 보임. 직접 지구의 질량, 반지름, 만유인력 상수 값을 조사하고 이를 공식에 대입하여 지표면에서의 중력가속도 값을 성공적으로 계산해냄. 이 과정에서 이론값이 실제 측정값과 근소한 차이를 보이는 이유를 지구의 자전과 불균일한 질량 분포 등과 연관 지어 분석하며 문제의 본질을 다각적으로 파악하는 비판적 사고력을 보여줌. 추상적인 물리 법칙을 구체적인 수치로 현실 세계와 연결하는 경험을 통해 물리학에 대한 깊은 관심을 보이는 학생임.`; 
// ─────────────────────────────────────────────────────────
// 🚀 GEMS AI 비서 - 기존 3.5-flash 안정화 버전 (에러 없는 오리지널 모드)
// ─────────────────────────────────────────────────────────

let gemsController = null;
window.GEMS_FILE_DATA = null;

// [파일 업로드 함수]
window.uploadGemsFile = async function(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || !fileInput.files[0]) {
        alert("업로드할 물리학 성취기준 파일을 선택하세요!");
        return;
    }

    const file = fileInput.files[0];
    const resultBox = document.getElementById("gems-result-box");
    if(resultBox) resultBox.value = "구글 서버에 성취기준 가이드를 업로드하는 중입니다...";

    try {
        const metadata = { file: { displayName: file.name } };
        const formData = new FormData();
        formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        formData.append("file", file);

        const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${window.GEMS_API_KEY}`;

        const response = await fetch(url, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`업로드 실패 (HTTP ${response.status})`);

        const data = await response.json();
        
        window.GEMS_FILE_DATA = {
            uri: data.file.uri,
            mimeType: data.file.mimeType,
            fileName: file.name
        };

        // 파일이 성공적으로 올라가면 체크박스를 자동으로 켜줍니다.
        const fileCheckbox = document.getElementById("gems-use-file-checkbox");
        if (fileCheckbox) fileCheckbox.checked = true;

        if(resultBox) resultBox.value = `🎉 성취기준 파일 처리 완료!\n파일명: ${file.name}\n\n'성취기준 가이드 반영' 체크박스가 켜진 상태에서 생기부를 생성하면 이 파일을 바탕으로 작성됩니다.`;

    } catch (error) {
        if(resultBox) resultBox.value = "파일 연동 중 에러 발생: " + error.message;
        console.error(error);
    }
};

// [생기부 생성 엔진 함수]
window.runGemsEngine = async function() {
    const memo = document.getElementById("gems-obs-input")?.value || ""; 
    const resultBox = document.getElementById("gems-result-box");
    const btn = document.getElementById("gems-submit-btn");
    const stopBtn = document.getElementById("gems-stop-btn");
    const byteLimitInput = document.getElementById("gems-byte-limit");
    
    // 💥 [추가] 파일 사용 여부 체크박스 가져오기
    const fileCheckbox = document.getElementById("gems-use-file-checkbox");
    const shouldIncludeFile = fileCheckbox ? fileCheckbox.checked : false;

    if(!memo || memo.trim() === "") { 
        alert("학생 메모를 입력하세요!"); 
        return; 
    }

    let byteLimit = parseInt(byteLimitInput?.value, 10);
    if (!byteLimit || byteLimit <= 0) byteLimit = 1000;

    if(resultBox) resultBox.value = "AI 비서가 생기부 문장을 정성껏 작성하고 있습니다...";
    if(btn) btn.disabled = true;
    if(btn) btn.style.display = "none";      
    if(stopBtn) stopBtn.style.display = "inline-block"; 

    gemsController = new AbortController();  

    try {
        // 💥 1. 라디오 버튼에서 현재 체크된 모델의 value(이름)를 가져옵니다.
const selectedModel = document.querySelector('input[name="gems-model-select"]:checked').value;

// 💥 2. URL 중간에 있는 모델 이름 자리에 변수(${selectedModel})를 쏙 넣어줍니다.
const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${window.GEMS_API_KEY}`;
        // 💡 LLM은 "바이트를 직접 계산해서 맞추기" 같은 정밀 산술에 약하므로,
        // 모델이 실제로 잘 지킬 수 있는 '글자 수' 목표치를 1차 기준으로 주고
        // 나이스 바이트 기준은 참고 정보로만 덧붙인다. (최종 검증은 클라이언트에서 재계산)
const inflatedByteLimit = byteLimit * 1.55; 
const approxCharTarget = Math.round(inflatedByteLimit / 2.6); 
const minCharTarget = Math.round(approxCharTarget * 0.85);
        const byteLimitInstruction = `[분량 지침 - 반드시 준수]\n- 목표 분량: 한글 기준 약 ${minCharTarget}~${approxCharTarget}자 사이로 작성해줘. (이 글자 수 목표를 최우선으로 지켜줘)\n- 참고: 나이스(NEIS) 바이트 환산 기준으로는 약 ${byteLimit}바이트에 해당하는 분량이다. (한글 등 유니코드 128 초과 문자는 3바이트, 영문/숫자/공백/기본기호는 1바이트로 환산)\n- 바이트를 문장 쓰면서 직접 암산하려 하지 말고, 위에 제시된 글자 수 범위 안에서 자연스럽고 완결된 문장으로 작성하는 데 집중해줘.\n- 글자 수가 부족한 채로 문장을 어색하게 끊지 말고, 범위 내에서 알맹이 있는 내용으로 채워줘.`;

        const requestParts = [];

        // 💥 [수정] 체크박스가 켜져 있고 + 업로드된 파일 데이터가 있을 때만 파일 전송!
        if (shouldIncludeFile && window.GEMS_FILE_DATA) {
            requestParts.push({
                fileData: {
                    mimeType: window.GEMS_FILE_DATA.mimeType,
                    fileUri: window.GEMS_FILE_DATA.uri
                }
            });
        } else if (shouldIncludeFile && !window.GEMS_FILE_DATA) {
            // 체크박스는 켰는데 정작 파일을 안 올린 경우 경고 후 중단
            alert("성취기준 가이드 반영이 체크되어 있지만, 업로드된 파일이 없습니다. 파일을 먼저 업로드하거나 체크박스를 해제해 주세요.");
            if(resultBox) resultBox.value = "파일이 없습니다. 업로드 후 다시 시도해 주세요.";
            // 강제로 버튼 UI 원상복구
            if(btn) { btn.disabled = false; btn.style.display = "inline-block"; }
            if(stopBtn) { stopBtn.style.display = "none"; }
            return;
        }

        requestParts.push(
            { text: `[시스템 지침 및 기본 규칙]\n${GEMS_SYSTEM_PROMPT}\n\n[작성 예시 자료]\n${GEMS_REFERENCE_DATA}\n\n` },
            { text: byteLimitInstruction },
            { text: `[이번에 작성할 학생 관찰 메모]\n${memo}` }
        );

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: requestParts }],
                // 💡 maxOutputTokens을 안 주면 모델 기본값에 맡겨지는데, 이 경우 답변이 예기치 않게
                // 잘리는 사례가 있어 목표 분량보다 넉넉하게(여유분 포함) 상한선을 함께 지정한다.
                generationConfig: {
                    temperature: 0.4,
                    topP: 0.8,
                    maxOutputTokens: Math.min(8192, Math.max(2048, byteLimit * 3))
                }
            }),
            signal: gemsController.signal   
        });

        const data = await response.json();

        if (data.error) {
            // 💥 [추가] 파일 API 만료(48시간 지나 구글 서버에서 지워짐) 에러 핸들링
            // 구글 File API 만료 시 주로 404 (NOT_FOUND) 에러나 'files/' 관련 메시지가 떨어집니다.
            if (data.error.status === "NOT_FOUND" || data.error.message.includes("files/")) {
                alert("⚠️ 구글 서버에 올라간 성취기준 가이드 파일이 만료되었습니다 (최대 48시간 유지).\n파일을 다시 선택해 [구글 서버 업로드] 버튼을 눌러주세요!");
                if(resultBox) resultBox.value = "성취기준 가이드 파일이 만료되었습니다. 파일을 다시 업로드해 주세요.";
                window.GEMS_FILE_DATA = null; // 만료된 주소 초기화
            } else {
                if(resultBox) resultBox.value = "구글 API 에러 발생: " + data.error.message;
            }
        } else if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
            if(resultBox) resultBox.value = data.candidates[0].content.parts[0].text;
            // 응답이 도중에 잘렸다면(MAX_TOKENS) 사용자에게 알려준다
            if (data.candidates[0].finishReason === "MAX_TOKENS") {
                if(resultBox) resultBox.value += "\n\n[⚠️ 응답이 최대 길이 제한으로 중간에 잘렸습니다. '생성 길이 제한' 값을 낮추거나 다시 시도해 주세요.]";
            }
        } else {
            if(resultBox) resultBox.value = "구글 서버 응답이 올바르지 않습니다. 다시 시도해 주세요.";
        }

    } catch (error) {
        if (error.name === "AbortError") {                      
            if(resultBox) resultBox.value = "생기부 생성이 중지되었습니다.";
        } else {
            if(resultBox) resultBox.value = "연동 오류가 발생했습니다: " + error.message;
        }
    } finally {
        if(btn) { btn.disabled = false; btn.style.display = "inline-block"; }
        if(stopBtn) { stopBtn.style.display = "none"; }
        updateGemsResultBytes(byteLimit); // 💡 결과 바이트 카운터 갱신 (기존엔 이 호출이 누락되어 항상 0Byte로 표시됨)
        gemsController = null;
    }
}

window.stopGemsEngine = function() {
    if (gemsController) {
        gemsController.abort();
    }
}

// ═══════════════════════════════════════════════════════════
// 📋 상담 관리자 기능 (admin.html 통합)
// ═══════════════════════════════════════════════════════════

// ── 상담 관리자 초기화 ──
function admInitApp() {
  const now = new Date();
  admYear = now.getFullYear();
  admMonth = now.getMonth();
  const dateEl = document.getElementById('adm-header-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('ko-KR');
  // 달력 초기 렌더 (slotsCache가 이미 로드되면 자동 호출되므로 빈 상태로 한 번만 그립니다)
  admRenderCal();
}

// ── 오늘 상담 알림 ──
function admMaybeShowTodayAlert() {
  if (!_slotsReady || !_bookingsReady || adm_alertShown) return;
  adm_alertShown = true;

  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
  const books = bookingsCache[today] || [];
  if (!books.length) return;

  const slotData = slotsCache[today] || {};
  const customs  = slotData.custom || [];
  const FIXED_LABEL = { lunch: '점심 상담', after: '방과후 상담' };

  const todayLabelEl = document.getElementById('today-date-label');
  if (todayLabelEl) todayLabelEl.textContent = `📅 ${today}`;

  const listEl = document.getElementById('today-booking-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  books.sort((a, b) => {
    const order = { lunch: 0, after: 1, custom: 2 };
    return (order[a.type] ?? 2) - (order[b.type] ?? 2);
  }).forEach(b => {
    let tagClass = b.type;
    let tagLabel = FIXED_LABEL[b.type] || '커스텀';
    let timeStr  = ADM_FIXED_TIMES[b.type] || '';
    if (b.type === 'custom') {
      const cs = customs[b.customIdx];
      if (cs) { tagLabel = cs.name; timeStr = `${cs.start} – ${cs.end}`; }
    }
    const item = document.createElement('div');
    item.className = 'today-booking-item';
    item.innerHTML = `
      <span class="today-slot-tag ${tagClass}">${tagLabel}</span>
      <div>
        <div class="today-booking-name">${b.name}</div>
        <div class="today-booking-time">${timeStr}</div>
      </div>
    `;
    listEl.appendChild(item);
  });

  const todayOverlay = document.getElementById('today-overlay');
  if (todayOverlay) todayOverlay.classList.add('show');

  const gotoBtn = document.getElementById('today-goto-btn');
  if (gotoBtn) gotoBtn.onclick = () => {
    todayOverlay.classList.remove('show');
    admSelectDate(today);
    const [y, m] = today.split('-').map(Number);
    admYear = y; admMonth = m - 1;
    admRenderCal();
    switchTab('counsel');
  };
}

// ── 달력 ──
window.admChangeMonth = (dir) => {
  admMonth += dir;
  if (admMonth > 11) { admMonth = 0; admYear++; }
  else if (admMonth < 0) { admMonth = 11; admYear--; }
  admRenderCal();
};

function admFmtDate(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function admRenderCal() {
  const titleEl = document.getElementById('adm-cal-title');
  if (!titleEl) return;
  titleEl.textContent = `${admYear}년 ${admMonth+1}월`;
  const grid = document.getElementById('adm-cal-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const firstDay = new Date(admYear, admMonth, 1).getDay();
  const lastDate = new Date(admYear, admMonth+1, 0).getDate();

  for (let i = 0; i < firstDay; i++) grid.innerHTML += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= lastDate; d++) {
    const key = admFmtDate(admYear, admMonth, d);
    const s = slotsCache[key] || {};
    const cell = document.createElement('div');
    cell.className = `cal-cell ${key === admSelectedDate ? 'selected' : ''}`;
    cell.onclick = () => admSelectDate(key);
    cell.innerHTML = `<div class="cell-date">${d}</div>`;
    if (s.lunch) cell.innerHTML += `<div class="slot-badge lunch-open"><span>점심</span></div>`;
    if (s.after)  cell.innerHTML += `<div class="slot-badge after-open"><span>방과후</span></div>`;
    const customs = s.custom || [];
    customs.filter(c => c.open).forEach(c => {
      cell.innerHTML += `<div class="slot-badge custom-open"><span>${c.name}</span></div>`;
    });
    grid.appendChild(cell);
  }
}

function admSelectDate(key) {
  admSelectedDate = key;
  admRenderCal();
  admRenderSlotPanel(key);
  admRenderBookingPanel(key);
  const addSlot = document.getElementById('adm-add-slot-section');
  if (addSlot) addSlot.style.display = 'block';
}

// ── 슬롯 패널 ──
function admRenderSlotPanel(key) {
  const s = slotsCache[key] || { lunch: false, after: false, custom: [] };
  const books = bookingsCache[key] || [];
  const titleEl = document.getElementById('adm-slot-title');
  if (titleEl) titleEl.textContent = key;
  const rows = document.getElementById('adm-slot-rows');
  if (!rows) return;
  rows.innerHTML = '';

  ['lunch', 'after'].forEach(type => {
    const hasBook = books.some(b => b.type === type);
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = `
      <div>
        <div class="slot-label ${type}">${type === 'lunch' ? '점심 상담' : '방과후 상담'}</div>
        <div class="slot-time">${ADM_FIXED_TIMES[type]}</div>
        ${hasBook ? '<div style="color:orange;font-size:11px">※ 예약 있음 (닫기 불가)</div>' : ''}
      </div>
      <label class="toggle">
        <input type="checkbox" ${s[type] ? 'checked' : ''} ${hasBook ? 'disabled' : ''}
          onchange="window.admToggleSlot('${key}', '${type}', this.checked)">
        <span class="toggle-track"></span>
      </label>
    `;
    rows.appendChild(row);
  });

  const customs = s.custom || [];
  customs.forEach((c, idx) => {
    const hasBook = books.some(b => b.type === 'custom' && b.customIdx === idx);
    const row = document.createElement('div');
    row.className = 'custom-slot-row';
    row.innerHTML = `
      <div class="custom-slot-info">
        <div class="custom-slot-name">✦ ${c.name}</div>
        <div class="custom-slot-time">${c.start} – ${c.end}</div>
        ${hasBook ? '<div style="color:orange;font-size:11px">※ 예약 있음</div>' : ''}
      </div>
      <div class="custom-slot-actions">
        ${!hasBook ? `<button class="del-slot-btn" onclick="window.admDeleteCustomSlot('${key}', ${idx})">삭제</button>` : ''}
        <label class="toggle">
          <input type="checkbox" ${c.open ? 'checked' : ''} ${hasBook ? 'disabled' : ''}
            onchange="window.admToggleCustomSlot('${key}', ${idx}, this.checked)">
          <span class="toggle-track"></span>
        </label>
      </div>
    `;
    rows.appendChild(row);
  });
}

// ── 슬롯 토글 ──
window.admToggleSlot = async (date, type, val) => {
  await setDoc(doc(db, 'slots', date), { [type]: val }, { merge: true });
};

window.admAddCustomSlot = async () => {
  if (!admSelectedDate) return;
  const name  = document.getElementById('adm-cs-name').value.trim();
  const start = document.getElementById('adm-cs-start').value.trim();
  const end   = document.getElementById('adm-cs-end').value.trim();
  if (!name) { alert('슬롯 이름을 입력하세요.'); return; }
  if (!start || !end) { alert('시작/종료 시간을 입력하세요.'); return; }
  const ref = doc(db, 'slots', admSelectedDate);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data().custom || []) : [];
  await setDoc(ref, { custom: [...existing, { name, start, end, open: true }] }, { merge: true });
  document.getElementById('adm-cs-name').value = '';
  document.getElementById('adm-cs-start').value = '';
  document.getElementById('adm-cs-end').value = '';
};

window.admToggleCustomSlot = async (date, idx, val) => {
  const ref = doc(db, 'slots', date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const customs = snap.data().custom || [];
  customs[idx].open = val;
  await updateDoc(ref, { custom: customs });
};

window.admDeleteCustomSlot = async (date, idx) => {
  if (!(await customConfirm('이 슬롯을 삭제할까요?'))) return;
  const ref = doc(db, 'slots', date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const customs = snap.data().custom || [];
  customs.splice(idx, 1);
  await updateDoc(ref, { custom: customs });
};

// ── 예약 패널 ──
function admRenderBookingPanel(key) {
  const books = bookingsCache[key] || [];
  const list = document.getElementById('adm-booking-list');
  const subEl = document.getElementById('adm-booking-sub');
  if (!list) return;
  if (subEl) subEl.textContent = `${key} 예약 목록`;
  list.innerHTML = '';

  if (!books.length) {
    list.innerHTML = '<p class="no-date-msg">예약이 없습니다.</p>';
    return;
  }

  const slotData = slotsCache[key] || {};
  const customs = slotData.custom || [];

  books.sort((a, b) => {
    const order = { lunch: 0, after: 1, custom: 2 };
    return (order[a.type] ?? 2) - (order[b.type] ?? 2);
  }).forEach(b => {
    const item = document.createElement('div');
    item.className = 'booking-item';
    let typeBadge = '';
    let slotName = '';
    if (b.type === 'lunch') {
      typeBadge = '<span class="b-type lunch">점심</span>';
    } else if (b.type === 'after') {
      typeBadge = '<span class="b-type after">방과후</span>';
    } else if (b.type === 'custom') {
      typeBadge = '<span class="b-type custom">커스텀</span>';
      const cs = customs[b.customIdx];
      if (cs) slotName = `<div class="b-slot">✦ ${cs.name} (${cs.start}–${cs.end})</div>`;
    }
    const hasRecord = Object.values(recordsCache).some(r => r.bookingId === b.id);
    item.innerHTML = `
      ${typeBadge}<span class="b-name">${b.name}</span>
      ${slotName}
      <div class="b-content">${b.content || ''}</div>
      <button class="b-record ${hasRecord ? 'b-has-record' : ''}" onclick="window.admOpenRecordModal('${b.id}', '${b.name}', '${b.date}', '${b.type}')">기록 ${hasRecord ? '수정' : '작성'}</button>
      <button class="b-delete" onclick="window.admDeleteBooking('${b.id}')">삭제</button>
    `;
    list.appendChild(item);
  });
}

window.admDeleteBooking = async (id) => {
  if (await customConfirm('이 예약을 삭제할까요? 학생 페이지에서도 사라집니다.')) {
    await deleteDoc(doc(db, 'bookings', id));
  }
};

// ── 상담 기록 ──
window.admOpenRecordModal = async (bookingId, name, date, type) => {
  _currentRecordBookingId = bookingId;
  const FIXED_LABEL = { lunch: '점심 상담', after: '방과후 상담', custom: '커스텀 상담' };
  const infoEl = document.getElementById('rec-info');
  if (infoEl) infoEl.textContent = `${date}  ${FIXED_LABEL[type] || type}  —  ${name}`;
  const existing = Object.values(recordsCache).find(r => r.bookingId === bookingId);
  const recContent = document.getElementById('rec-content');
  const recPrivate = document.getElementById('rec-private');
  if (recContent) recContent.value = existing?.content || '';
  if (recPrivate) recPrivate.value = existing?.privateNote || '';
  const overlay = document.getElementById('rec-overlay');
  if (overlay) overlay.classList.add('show');
};

window.admSaveRecord = async () => {
  const content     = document.getElementById('rec-content').value.trim();
  const privateNote = document.getElementById('rec-private').value.trim();
  if (!content) { alert('상담 내용을 입력하세요.'); return; }
  const existingEntry = Object.entries(recordsCache).find(([, r]) => r.bookingId === _currentRecordBookingId);
  const ref = existingEntry
    ? doc(db, 'records', existingEntry[0])
    : doc(collection(db, 'records'));
  await setDoc(ref, {
    bookingId: _currentRecordBookingId,
    content,
    privateNote,
    updatedAt: Date.now()
  }, { merge: true });
  const overlay = document.getElementById('rec-overlay');
  if (overlay) overlay.classList.remove('show');
};

// ── 학생 이력 조회 ──
window.admSearchHistory = async () => {
  const name = document.getElementById('hist-name-input').value.trim();
  if (!name) { alert('이름을 입력하세요.'); return; }
  const body = document.getElementById('hist-body');
  body.innerHTML = '<p class="hist-empty">조회 중...</p>';
  const q = query(collection(db, 'bookings'), where('name', '==', name));
  const snap = await getDocs(q);
  if (snap.empty) {
    body.innerHTML = `<p class="hist-empty">${name} 학생의 상담 내역이 없습니다.</p>`;
    return;
  }
  const bookings = [];
  snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));
  bookings.sort((a, b) => a.date > b.date ? -1 : 1);
  const FIXED_LABEL = { lunch: '점심 상담', after: '방과후 상담', custom: '커스텀 상담' };
  const FIXED_TIME  = { lunch: '12:40–13:00', after: '15:10–15:30' };
  body.innerHTML = '';
  for (const b of bookings) {
    const record = Object.values(recordsCache).find(r => r.bookingId === b.id);
    const slotInfo = slotsCache[b.date] || {};
    let typeLabel = FIXED_LABEL[b.type] || b.type;
    let timeStr   = FIXED_TIME[b.type] || '';
    if (b.type === 'custom') {
      const cs = (slotInfo.custom || [])[b.customIdx];
      if (cs) { typeLabel = cs.name; timeStr = `${cs.start}–${cs.end}`; }
    }
    const item = document.createElement('div');
    item.className = 'hist-item';
    item.innerHTML = `
      <div class="hist-item-header">
        <span class="hist-item-date">${b.date}</span>
        <span class="b-type ${b.type}">${typeLabel}</span>
        <span style="font-size:.75rem;color:var(--muted)">${timeStr}</span>
      </div>
      <div class="hist-item-body">
        ${b.content ? `<div class="hist-request-text">💬 신청 내용: ${b.content}</div>` : ''}
        ${record ? `
          <div class="hist-section-label">상담 기록</div>
          <div class="hist-section-text">${record.content}</div>
          ${record.privateNote ? `
            <div class="hist-private-box">
              <div class="hist-private-label">🔒 비공개 메모</div>
              <div class="hist-private-text">${record.privateNote}</div>
            </div>
          ` : ''}
        ` : '<div style="color:#bbb;font-size:.82rem">기록 없음</div>'}
      </div>
    `;
    body.appendChild(item);
  }
};

// ── 통계 & 내보내기 ──
window.openStatModal = () => {
  document.getElementById('stat-overlay').classList.add('show');
  admRenderStatTab('overview');
  document.querySelectorAll('.stat-tab').forEach((t,i) => t.classList.toggle('active', i===0));
};

window.admSwitchStatTab = (tab, el) => {
  _statTab = tab;
  document.querySelectorAll('.stat-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  admRenderStatTab(tab);
};

function admGetAllBookings() {
  const all = [];
  Object.values(bookingsCache).forEach(arr => arr.forEach(b => all.push(b)));
  return all.sort((a,b) => a.date < b.date ? -1 : 1);
}

function admRenderStatTab(tab) {
  const body = document.getElementById('stat-body');
  if (!body) return;
  const all = admGetAllBookings();
  if (tab === 'overview') admRenderOverview(body, all);
  else if (tab === 'monthly') admRenderMonthly(body, all);
  else admRenderExport(body);
}

function admRenderOverview(body, all) {
  const total = all.length;
  const byType = { lunch: 0, after: 0, custom: 0 };
  const byName = {};
  all.forEach(b => {
    byType[b.type] = (byType[b.type] || 0) + 1;
    byName[b.name] = (byName[b.name] || 0) + 1;
  });
  const topStudents = Object.entries(byName).sort((a,b) => b[1]-a[1]).slice(0, 10);
  const maxCnt = topStudents[0]?.[1] || 1;
  const TYPE_LABEL = { lunch: '점심 상담', after: '방과후 상담', custom: '커스텀 상담' };
  body.innerHTML = `
    <div class="stat-section">
      <div class="stat-summary-grid">
        <div class="stat-summary-card"><div class="stat-summary-num">${total}</div><div class="stat-summary-label">전체 상담 횟수</div></div>
        <div class="stat-summary-card"><div class="stat-summary-num">${Object.keys(byName).length}</div><div class="stat-summary-label">상담 학생 수</div></div>
        <div class="stat-summary-card"><div class="stat-summary-num">${topStudents[0]?.[1] || 0}</div><div class="stat-summary-label">최다 상담 횟수</div></div>
      </div>
    </div>
    <div class="stat-section">
      <h4>슬롯 유형별 현황</h4>
      ${['lunch','after','custom'].map(t => `
        <div class="stat-row">
          <div class="stat-bar-label">${TYPE_LABEL[t]}</div>
          <div class="stat-bar-wrap"><div class="stat-bar ${t}" style="width:${total ? (byType[t]||0)/total*100 : 0}%"></div></div>
          <div class="stat-count">${byType[t]||0}회</div>
        </div>`).join('')}
    </div>
    <div class="stat-section">
      <h4>자주 온 학생 TOP 10</h4>
      <ul class="stat-top-list">
        ${topStudents.map(([name, cnt], i) => `
          <li class="stat-top-item">
            <span class="stat-top-rank">${i+1}</span>
            <span class="stat-top-name">${name}</span>
            <div class="stat-bar-wrap" style="max-width:160px"><div class="stat-bar total" style="width:${cnt/maxCnt*100}%"></div></div>
            <span class="stat-top-cnt">${cnt}회</span>
          </li>`).join('')}
        ${topStudents.length === 0 ? '<li class="stat-top-item" style="color:#bbb;justify-content:center">데이터 없음</li>' : ''}
      </ul>
    </div>
  `;
}

function admRenderMonthly(body, all) {
  const monthly = {};
  all.forEach(b => {
    const ym = b.date.slice(0, 7);
    if (!monthly[ym]) monthly[ym] = { lunch:0, after:0, custom:0 };
    monthly[ym][b.type] = (monthly[ym][b.type] || 0) + 1;
  });
  const months = Object.keys(monthly).sort();
  const maxTotal = Math.max(...months.map(m => monthly[m].lunch + monthly[m].after + (monthly[m].custom||0)), 1);
  if (!months.length) { body.innerHTML = '<p class="hist-empty">데이터가 없습니다.</p>'; return; }
  body.innerHTML = `
    <div class="stat-section">
      <h4>월별 상담 횟수</h4>
      ${months.slice().reverse().map(ym => {
        const d = monthly[ym];
        const total = d.lunch + d.after + (d.custom||0);
        return `
          <div class="stat-row">
            <div class="stat-bar-label">${ym}</div>
            <div class="stat-bar-wrap">
              <div style="display:flex;height:100%">
                <div style="width:${d.lunch/maxTotal*100}%;background:var(--lunch-accent)" title="점심 ${d.lunch}"></div>
                <div style="width:${d.after/maxTotal*100}%;background:var(--after-accent)" title="방과후 ${d.after}"></div>
                <div style="width:${(d.custom||0)/maxTotal*100}%;background:var(--custom-accent)" title="커스텀 ${d.custom||0}"></div>
              </div>
            </div>
            <div class="stat-count">${total}회</div>
          </div>`;
      }).join('')}
      <div style="display:flex;gap:16px;margin-top:14px;font-size:.75rem">
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--lunch-accent);display:inline-block;border-radius:2px"></span>점심</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--after-accent);display:inline-block;border-radius:2px"></span>방과후</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--custom-accent);display:inline-block;border-radius:2px"></span>커스텀</span>
      </div>
    </div>
  `;
}

function admRenderExport(body) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  body.innerHTML = `
    <div class="stat-section">
      <h4>상담 기록 내보내기</h4>
      <p style="font-size:.82rem;color:var(--muted);margin-bottom:16px">예약 정보 + 상담 기록을 CSV 파일로 저장합니다.<br>기간을 지정하거나 전체 내보내기가 가능합니다.</p>
      <div class="export-row">
        <span style="font-size:.82rem;font-weight:600">기간</span>
        <input type="month" id="exp-from" value="${thisMonth}">
        <span style="font-size:.82rem">~</span>
        <input type="month" id="exp-to" value="${thisMonth}">
        <button class="export-btn csv" onclick="window.admExportCSV(false)">📥 기간 CSV</button>
      </div>
      <div class="export-row" style="margin-top:10px">
        <button class="export-btn excel" onclick="window.admExportCSV(true)" style="background:var(--ink)">📥 전체 CSV</button>
      </div>
      <p class="export-hint">※ CSV는 엑셀에서 바로 열 수 있습니다. 비공개 메모 포함.</p>
    </div>
  `;
}

window.admExportCSV = (allData) => {
  const all = admGetAllBookings();
  const FIXED_LABEL = { lunch: '점심 상담', after: '방과후 상담', custom: '커스텀 상담' };
  const FIXED_TIME  = { lunch: '12:40-13:00', after: '15:10-15:30' };
  let rows = all;
  if (!allData) {
    const from = document.getElementById('exp-from')?.value || '';
    const to   = document.getElementById('exp-to')?.value   || '';
    if (from) rows = rows.filter(b => b.date.slice(0,7) >= from);
    if (to)   rows = rows.filter(b => b.date.slice(0,7) <= to);
  }
  if (!rows.length) { alert('해당 기간에 데이터가 없습니다.'); return; }
  const headers = ['날짜','슬롯','시간','학생이름','신청내용','상담기록','비공개메모'];
  const csvRows = [headers];
  rows.forEach(b => {
    const slotInfo = slotsCache[b.date] || {};
    let typeLabel = FIXED_LABEL[b.type] || b.type;
    let timeStr   = FIXED_TIME[b.type] || '';
    if (b.type === 'custom') {
      const cs = (slotInfo.custom || [])[b.customIdx];
      if (cs) { typeLabel = cs.name; timeStr = cs.start + '-' + cs.end; }
    }
    const rec = Object.values(recordsCache).find(r => r.bookingId === b.id);
    csvRows.push([
      b.date, typeLabel, timeStr, b.name,
      (b.content || '').replace(/\n/g, ' '),
      (rec ? rec.content || '' : '').replace(/\n/g, ' '),
      (rec ? rec.privateNote || '' : '').replace(/\n/g, ' ')
    ]);
  });
  const BOM = '\uFEFF';
  const lines = csvRows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  const csv = BOM + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = '상담기록_' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
};

// ═══════════════════════════════════════════════════════════


// 설정 모달 열기
// script.js 내에서
window.openSettingsModal = function() {
    document.getElementById('settingsModal').classList.add('show');
};

window.closeSettingsModal = function() {
    document.getElementById('settingsModal').classList.remove('show');
}
// ── [B] 학교 검색 및 Firebase 업로드 로직 ──

// 1. NEIS API 학교 검색
window.searchSchool = async function() {
  const schoolName = document.getElementById('searchSchoolName').value;
  if (!schoolName) return alert("학교 이름을 입력하세요.");

  const url = `https://open.neis.go.kr/hub/schoolInfo?Type=json&KEY=${window.NEIS_API_KEY}&SCHUL_NM=${encodeURIComponent(schoolName)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.schoolInfo) {
      const schools = data.schoolInfo[1].row;
      const selectEl = document.getElementById('schoolSelect');
      selectEl.innerHTML = ""; 

      schools.forEach(school => {
        const option = document.createElement('option');
        option.value = JSON.stringify({ 
          office: school.ATPT_OFCDC_SC_CODE, 
          school: school.SD_SCHUL_CODE 
        });
        option.text = `[${school.LCTN_SC_NM}] ${school.SCHUL_NM}`; 
        selectEl.appendChild(option);
      });

      document.getElementById('schoolResultDiv').style.display = "block";
    } else {
      alert("검색 결과가 없습니다.");
    }
  } catch (e) {
    console.error(e);
    alert("학교 정보를 불러오는 데 실패했습니다.");
  }
}

// 2. 선택한 학교 코드를 로컬 변수에 반영하고 + Firebase에 업로드하기
window.applySchoolCode = async function() {
  const selectEl = document.getElementById('schoolSelect');
  if (!selectEl.value) return;

  const codes = JSON.parse(selectEl.value);
  
  window.OFFICE_CODE = codes.office;
  window.SCHOOL_CODE = codes.school;

  try {
    await setDoc(doc(db, "schedules", "today"), {
      officeCode: window.OFFICE_CODE,
      schoolCode: window.SCHOOL_CODE,
      updatedAt: new Date()
    }, { merge: true });
    
    alert("학교 설정이 전 기기에 실시간 적용되었습니다!");
    
    // 1. 🔥 [핵심] 기존 학교의 학사일정 캐시를 통째로 비웁니다.
    // 이렇게 해야 새 학교의 학사일정으로 깨끗하게 덮어씌워집니다.
    if (typeof scheduleCache !== 'undefined') {
      scheduleCache = {}; 
    }

    // 2. 🔥 [핵심] 현재 달력 화면에 보이는 연도와 월을 기준으로 학사일정을 새로 불러옵니다.
    if (typeof miniCalYear !== 'undefined' && typeof miniCalMonth !== 'undefined') {
      fetchSchoolSchedule(miniCalYear, miniCalMonth);
    }

    // 3. 내 화면에서도 즉시 급식 새로고침 (typeof 오류 수정)
    if (typeof fetchNeisMeal === "function") fetchNeisMeal();

    // 모달창 닫기
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('show');

  } catch (e) {
    console.error("Firebase 학교 저장 에러:", e);
    alert("Firebase 저장에 실패했습니다.");
  }
}
// 4. 설정 저장 함수
window.saveSettings = function() {
    const schoolCode = document.getElementById('schoolResult').value;
    const startTime = document.getElementById('startTime').value;
    
    // 로컬 스토리지 등에 저장하여 새로고침 후에도 유지되게 합니다.
    localStorage.setItem('user_school_code', schoolCode);
    localStorage.setItem('user_start_time', startTime);
    
    alert('설정이 저장되었습니다.');
    closeSettingsModal();
}

// ── [최종] 비밀번호 변경 관련 스크립트 ──

// 1. 모달 열기
window.openPwModal = function() {
  const modal = document.getElementById("pw-modal");
  if (modal) {
    // 🔥 [핵심 치트키] 모달을 부모 요소 밖으로 꺼내서 body 바로 아래로 강제 이동시킵니다.
    // 이렇게 하면 다른 레이어 뒤에 파묻히는 현상이 원천 차단됩니다.
    document.body.appendChild(modal); 
    
    // 화면에 강제로 주입 및 중앙 정렬 활성화
    modal.style.setProperty("display", "flex", "important");
    
    // 인풋창 초기화
    document.getElementById("pw-cur").value = "";
    document.getElementById("pw-new").value = "";
    document.getElementById("pw-new2").value = "";
    document.getElementById("pw-modal-msg").innerText = "";
    
    console.log("🎯 모달을 body 최상단 레이어로 이동하고 display: flex를 적용했습니다.");
  } else {
    console.error("❌ 아이디가 'pw-modal'인 요소를 HTML에서 찾을 수 없습니다.");
  }
};

// 2. 모달 닫기
window.closePwModal = function() {
  const modal = document.getElementById("pw-modal");
  if (modal) modal.style.display = "none";
};

// 3. 비밀번호 변경 실행
window.doChangePw = async function() {
  const curPw = document.getElementById("pw-cur").value.trim();
  const newPw = document.getElementById("pw-new").value.trim();
  const newPw2 = document.getElementById("pw-new2").value.trim();
  const msgEl = document.getElementById("pw-modal-msg");

  if (!curPw || !newPw || !newPw2) {
    msgEl.style.color = "red";
    msgEl.innerText = "❌ 모든 항목을 입력해주세요.";
    return;
  }
  if (newPw.length < 4) {
    msgEl.style.color = "red";
    msgEl.innerText = "❌ 새 비밀번호는 4자 이상이어야 합니다.";
    return;
  }
  if (newPw !== newPw2) {
    msgEl.style.color = "red";
    msgEl.innerText = "❌ 새 비밀번호가 일치하지 않습니다.";
    return;
  }

  try {
    // 💡 window.db가 살아있으므로, 내부 라이브러리를 동적으로 안전하게 활용합니다.
    const { doc, getDoc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    
    const docRef = doc(window.db, "settings", "adminInfo");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const currentAdminPw = docSnap.data().pw;

      if (curPw !== currentAdminPw) {
        msgEl.style.color = "red";
        msgEl.innerText = "❌ 현재 비밀번호가 일치하지 않습니다.";
        return;
      }

      // 새 비밀번호로 파이어베이스 업데이트
      await updateDoc(docRef, { pw: newPw });
      
      msgEl.style.color = "green";
      msgEl.innerText = "✅ 비밀번호가 성공적으로 변경되었습니다!";
      
      // 1.5초 후 자동 닫기
      setTimeout(() => {
        window.closePwModal();
      }, 1500);

    } else {
      msgEl.style.color = "red";
      msgEl.innerText = "❌ 파이어베이스에서 adminInfo 문서를 찾을 수 없습니다.";
    }
  } catch (error) {
    console.error("비밀번호 변경 중 오류:", error);
    msgEl.style.color = "red";
    msgEl.innerText = "❌ 오류가 발생했습니다. 콘솔을 확인해 주세요.";
  }
};

// ── [2번 기능] 로그아웃 버튼 스크립트 ──

window.doLogout = async function() {
  if (await customConfirm("로그아웃 하시겠습니까?")) {
    try {
      // 1. 필요한 파이어베이스 기능들을 그 자리에서 직접 로드합니다.
      const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
      const { signOut } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
      
      // 2. 파일에 이미 존재하는 auth 객체나 초기화된 app 객체를 찾아서 매칭합니다.
      let currentAuth = window.auth;
      
      if (!currentAuth) {
        // 만약 window.auth가 비어있다면, 이미 선언된 firebaseApp이나 app을 찾아 auth를 강제 생성합니다.
        const targetApp = window.app || window.firebaseApp;
        if (targetApp) {
          currentAuth = getAuth(targetApp);
        } else {
          // 최후의 수단: 그냥 기본 인증 객체를 호출
          currentAuth = getAuth();
        }
      }

      // 3. 로그아웃 실행
      await signOut(currentAuth);
      
      alert("로그아웃 되었습니다.");
      location.reload(); // 새로고침해서 로그인 화면으로 이동
    } catch (error) {
      console.error("로그아웃 중 오류 발생:", error);
      alert("로그아웃 실패: " + error.message);
    }
  }
};


const FONT_SIZE_KEY = "dashboard-font-size";
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE = 13;
const MAX_FONT_SIZE = 22;
const STEP = 1;

function applyFontSize(size) {
    document.documentElement.style.fontSize = size + "px";
    localStorage.setItem(FONT_SIZE_KEY, size);
}

function getCurrentFontSize() {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_FONT_SIZE;
}

// 페이지 로드 시 저장된 크기 적용
applyFontSize(getCurrentFontSize());

document.getElementById("font-increase-btn").addEventListener("click", () => {
    applyFontSize(Math.min(MAX_FONT_SIZE, getCurrentFontSize() + STEP));
});

document.getElementById("font-decrease-btn").addEventListener("click", () => {
    applyFontSize(Math.max(MIN_FONT_SIZE, getCurrentFontSize() - STEP));
});

document.getElementById("font-reset-btn").addEventListener("click", () => {
    applyFontSize(DEFAULT_FONT_SIZE);
});

})();