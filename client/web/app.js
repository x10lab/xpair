/**
 * RemotePair 온보딩 마법사 — app.js
 * vanilla JS, 빌드 없음, npm 없음. ES2017+ (macOS 내장 WebKit 기준).
 *
 * 토큰은 window.location 의 ?token= 파라미터에서 읽는다.
 * 모든 /api/* fetch 에 토큰을 포함 (X-Token 헤더 방식).
 *
 * 스텝 (역할에 따라 buildSteps(role) 로 동적으로 결정):
 *   host / both / empty:
 *     welcome, permissions, regrant(조건부), ssh, client-ssh-setup, maps, syncthing, verify
 *   client:
 *     welcome, host-guide, ssh, maps, syncthing, verify
 */

// ── 전역 상태 ─────────────────────────────────────────────────────────────────

const TOKEN = new URLSearchParams(window.location.search).get("token") || "";

// 현재 스텝 인덱스 (activeSteps 기준)
let currentStep = 0;

// 최신 /api/status 결과 캐시 (폴링이 덮어씀)
let lastStatus = null;

// 역할 선택값
let selectedRole = "";

// 역할에 따라 빌드된 실제 스텝 목록 (buildSteps 가 채움)
let activeSteps = [];

// ── 역할 판단 헬퍼 ────────────────────────────────────────────────────────────
// isHost = role is host | both | empty/missing (default host)
// isClient = role === "client" only
function isHost(role) {
  return !role || role === "host" || role === "both";
}
function isClient(role) {
  return role === "client";
}

// ── 스텝 빌더 ────────────────────────────────────────────────────────────────
function buildSteps(role) {
  if (isClient(role)) {
    // CLIENT: ACCESS ONLY — no AX/SR/permissions, no regrant
    return [
      { id: "welcome",    title: "환영합니다",      render: renderWelcome,        canNext: canNextWelcome },
      { id: "host-guide", title: "호스트 설정 안내", render: renderHostGuide,      canNext: () => true },
      { id: "ssh",        title: "SSH 점검",        render: renderSSH,            canNext: canNextSSH },
      { id: "maps",       title: "폴더 매핑",       render: renderMaps,           canNext: () => true },
      { id: "syncthing",  title: "Syncthing",       render: renderSyncthing,      canNext: () => true },
      { id: "verify",     title: "완료",            render: renderVerify,         canNext: () => false },
    ];
  } else {
    // HOST / BOTH / empty: full flow including permissions + regrant(conditional)
    const steps = [
      { id: "welcome",          title: "환영합니다",         render: renderWelcome,         canNext: canNextWelcome },
      { id: "permissions",      title: "권한",               render: renderPermissions,     canNext: canNextPerms },
      { id: "regrant",          title: "TCC 재허용",         render: renderRegrant,         canNext: () => true },
      { id: "ssh",              title: "SSH 점검",           render: renderSSH,             canNext: canNextSSH },
      { id: "client-ssh-setup", title: "클라이언트 SSH 설정", render: renderClientSshSetup,  canNext: () => true },
      { id: "maps",             title: "폴더 매핑",          render: renderMaps,            canNext: () => true },
      { id: "syncthing",        title: "Syncthing",          render: renderSyncthing,       canNext: () => true },
      { id: "verify",           title: "완료",               render: renderVerify,          canNext: () => false },
    ];
    return steps;
  }
}

// 캐시된 API 결과들
let sshResult    = null;
let mapsResult   = null;
let syncResult   = null;
let regrantResult = null;
let mountResult  = null;

// regrant 스킵 여부 (host flow 에서만 사용)
let skipRegrant = false;

// SSH wizard 서브스텝 (0=keygen, 1=copy-id, 2=verify)
let sshSubStep = 0;

// 핸드셰이크 폴링 타이머
let _handshakeTimer = null;
// 마지막 핸드셰이크 결과
let lastHandshake = null;

// 파일 접근 방식 선택: 'syncthing' | 'mount'
let fileAccessBackend = "syncthing";
// 마운트 백엔드: 'smb' | 'sshfs'
let mountBackend = "smb";

// ── API 헬퍼 ──────────────────────────────────────────────────────────────────

/** 공통 fetch — 모든 /api/* 에 X-Token 헤더 포함 */
async function api(path, options = {}) {
  const headers = { "X-Token": TOKEN, ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiGet(path) {
  return api(path);
}

async function apiPost(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── 상태 폴링 ─────────────────────────────────────────────────────────────────

/** 1.5초마다 /api/status 를 폴링해 lastStatus 를 갱신하고 배지 및 Next 버튼을 업데이트 */
async function pollStatus() {
  try {
    lastStatus = await apiGet("/api/status");
    updateStatusBar();
    refreshStepBadges();
    updateNextButton();
  } catch (e) {
    // 브리지 자체가 죽은 경우 — 조용히 무시
  }
}

function startPolling() {
  pollStatus(); // 즉시 한 번
  setInterval(pollStatus, 1500);
}

// ── 진행 표시줄 ───────────────────────────────────────────────────────────────

function renderProgressBar() {
  const visible = visibleSteps();
  const bar = document.getElementById("progress-bar");
  bar.innerHTML = `<div class="step-dots">${
    visible.map((_, i) => {
      const cls = i < currentStep ? "done" : i === currentStep ? "active" : "";
      return `<div class="step-dot ${cls}"></div>`;
    }).join("")
  }</div>`;
}

/** activeSteps 에서 regrant 스킵 여부를 반영한 실제 표시 스텝 목록 */
function visibleSteps() {
  return activeSteps.filter(s => !(s.id === "regrant" && skipRegrant));
}

// ── 상태 배지 바 ──────────────────────────────────────────────────────────────

function badge(label, ok) {
  const cls = ok === null ? "off" : ok ? "ok" : "err";
  const icon = ok === null ? "–" : ok ? "✓" : "✗";
  return `<span class="badge ${cls}">${icon} ${label}</span>`;
}

function updateStatusBar() {
  const s = lastStatus;
  const el = document.getElementById("status-bar");
  if (!el) return;

  if (!s) {
    el.innerHTML = `<span class="badge off">– 연결 중...</span>`;
    return;
  }

  const appLabel = s.appUp ? "앱 ✓" : "앱 ✗";
  const appCls   = s.appUp ? "ok" : "err";

  el.innerHTML = `
    <span class="badge ${appCls}">${appLabel}</span>
    ${badge("AX",  s.ax)}
    ${badge("SR",  s.sr)}
    ${badge("FDA", s.fda)}
    ${s.role ? `<span class="badge off">${esc(s.role)}</span>` : ""}
    ${s.host ? `<span class="badge off">${esc(s.host)}</span>` : ""}
  `;
}

// ── 스텝별 배지 갱신 (폴링 콜백) ─────────────────────────────────────────────

function refreshStepBadges() {
  if (!lastStatus) return;
  const visible = visibleSteps();
  const step = visible[currentStep];
  if (!step) return;

  if (step.id === "permissions") {
    updatePermBadges();
  }
}

// ── Next / Back 버튼 ──────────────────────────────────────────────────────────

function updateNextButton() {
  const btn = document.getElementById("btn-next");
  if (!btn) return;
  const visible = visibleSteps();
  const step = visible[currentStep];
  if (!step) return;
  btn.disabled = !step.canNext();
}

async function goNext() {
  const visible = visibleSteps();

  // permissions → regrant 전환 직전: regrant 필요 여부 확인
  if (visible[currentStep] && visible[currentStep].id === "permissions") {
    try {
      regrantResult = await apiGet("/api/regrant");
      skipRegrant = !regrantResult.needed;
    } catch (e) {
      skipRegrant = true; // 오류면 건너뜀
    }
  }

  // 핸드셰이크 폴링은 ssh 스텝을 떠날 때 정지
  if (visible[currentStep] && visible[currentStep].id === "ssh") {
    _stopHandshakePolling();
  }

  const nextVisible = visibleSteps(); // skipRegrant 가 방금 바뀌었을 수 있으므로 재계산
  if (currentStep < nextVisible.length - 1) {
    currentStep++;
    renderCurrentStep();
  }
}

function goBack() {
  // 핸드셰이크 폴링은 ssh 스텝을 떠날 때 정지
  const visible = visibleSteps();
  if (visible[currentStep] && visible[currentStep].id === "ssh") {
    _stopHandshakePolling();
  }

  if (currentStep > 0) {
    currentStep--;
    renderCurrentStep();
  }
}

// ── 메인 렌더 ─────────────────────────────────────────────────────────────────

function renderCurrentStep() {
  renderProgressBar();
  const visible = visibleSteps();
  const step = visible[currentStep];
  if (!step) return;
  const main = document.getElementById("main-content");
  main.innerHTML = step.render();
  afterRender();
  updateNextButton();
}

/** 렌더 후 이벤트 바인딩 + 비동기 데이터 로드 */
function afterRender() {
  const visible = visibleSteps();
  const step = visible[currentStep];
  if (!step) return;

  if (step.id === "welcome")          bindWelcome();
  if (step.id === "permissions")      bindPermissions();
  if (step.id === "regrant")          bindRegrant();
  if (step.id === "host-guide")       bindHostGuide();
  if (step.id === "ssh")              loadSSH();
  if (step.id === "client-ssh-setup") { /* static render, no bind needed */ }
  if (step.id === "maps")             loadFileAccess();
  if (step.id === "syncthing")        loadSyncthing();
  if (step.id === "verify")           loadVerify();

  // 네비게이션 버튼
  const btnNext = document.getElementById("btn-next");
  const btnBack = document.getElementById("btn-back");
  if (btnNext) btnNext.addEventListener("click", goNext);
  if (btnBack) btnBack.addEventListener("click", goBack);
}

// ── 스텝 0: Welcome + 역할 선택 ──────────────────────────────────────────────

function renderWelcome() {
  return `
    <div class="card">
      <h2>RemotePair 온보딩 마법사</h2>
      <p class="subtitle">
        이 마법사는 RemotePair 를 처음 설정하거나 재설정할 때 단계별로 안내합니다.<br>
        이 Mac 의 역할을 선택하세요.
      </p>
      <div class="role-grid">
        <button class="role-btn ${selectedRole==='host'?'selected':''}" data-role="host">
          <span class="role-icon">🖥️</span>Host<br>
          <small style="font-weight:400;font-size:11px;">Claude가 실행되는 Mac</small>
        </button>
        <button class="role-btn ${selectedRole==='client'?'selected':''}" data-role="client">
          <span class="role-icon">💻</span>Client<br>
          <small style="font-weight:400;font-size:11px;">조작하는 Mac</small>
        </button>
        <button class="role-btn ${selectedRole==='both'?'selected':''}" data-role="both">
          <span class="role-icon">⚡</span>Both<br>
          <small style="font-weight:400;font-size:11px;">로컬 단독 사용</small>
        </button>
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-primary" id="btn-next" ${selectedRole?'':'disabled'}>
        다음 →
      </button>
    </div>
  `;
}

function canNextWelcome() { return !!selectedRole; }

function bindWelcome() {
  document.querySelectorAll(".role-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      selectedRole = btn.dataset.role;
      // 선택 즉시 서버에 저장
      try { await apiPost("/api/role", { role: selectedRole }); } catch (e) { /* ignore */ }
      // 역할에 맞게 스텝 목록 재빌드 (welcome 은 항상 첫 스텝이므로 currentStep 은 0 유지)
      activeSteps = buildSteps(selectedRole);
      // UI 갱신
      document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderProgressBar(); // 스텝 수가 바뀌었으므로 진행 바도 갱신
      updateNextButton();
    });
  });
}

// ── 스텝 1: 권한 (AX / SR / FDA) ──────────────────────────────────────────────

const PERMS = [
  {
    key:   "ax",
    label: "Accessibility (접근성)",
    icon:  "♿",
    desc:  "approve 클릭·키 입력에 필요. System Settings → 개인 정보 보호 및 보안 → 접근성",
  },
  {
    key:   "sr",
    label: "Screen Recording (화면 녹화)",
    icon:  "🖥",
    desc:  "스크린샷 캡처에 필요. System Settings → 개인 정보 보호 및 보안 → 화면 녹화",
  },
  {
    key:   "fda",
    label: "Full Disk Access (전체 디스크 접근)",
    icon:  "💾",
    desc:  "파일 접근 확장에 필요 (선택 사항). System Settings → 개인 정보 보호 및 보안 → 전체 디스크 접근",
  },
];

function permStatusIcon(val) {
  if (val === null || val === undefined) return `<span class="perm-status" style="color:#aaa">?</span>`;
  return val
    ? `<span class="perm-status" style="color:var(--ok)">✓</span>`
    : `<span class="perm-status" style="color:var(--err)">✗</span>`;
}

function renderPermissions() {
  const s = lastStatus;
  const items = PERMS.map(p => {
    const val = s ? s[p.key] : null;
    return `
      <div class="perm-item" id="perm-${p.key}">
        <div class="perm-badge">${p.icon}</div>
        <div class="perm-info">
          <strong>${p.label}</strong>
          <small>${p.desc}</small>
        </div>
        ${permStatusIcon(val)}
        <button class="perm-open-btn" data-pane="${p.key}">설정 열기</button>
      </div>
    `;
  }).join("");

  return `
    <div class="card">
      <h2>권한 설정</h2>
      <p class="subtitle">
        macOS 는 사용자가 직접 시스템 설정에서 토글해야 합니다. 앱이 자동으로 켤 수 없습니다.<br>
        각 항목의 "설정 열기"를 클릭한 뒤 RemotePair 를 찾아 켜세요. 약 2초 후 자동으로 반영됩니다.
      </p>
      <div class="perm-list">${items}</div>
      <div class="perm-note">
        ⚠ AX + SR 이 모두 ✓ 이어야 <code>remote-pair approve</code> 와 computer-use 가 동작합니다.
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next">다음 →</button>
    </div>
  `;
}

function canNextPerms() {
  if (!lastStatus) return false;
  // AX + SR 모두 true 여야 Next 활성
  return lastStatus.ax === true && lastStatus.sr === true;
}

function updatePermBadges() {
  const s = lastStatus;
  if (!s) return;
  PERMS.forEach(p => {
    const item = document.getElementById(`perm-${p.key}`);
    if (!item) return;
    const icon = item.querySelector(".perm-status");
    if (icon) icon.outerHTML = permStatusIcon(s[p.key]);
  });
}

function bindPermissions() {
  document.querySelectorAll(".perm-open-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pane = btn.dataset.pane;
      try { await apiPost("/api/permissions/open", { pane }); } catch (e) { /* ignore */ }
    });
  });
}

// ── 스텝 2: TCC 재grant 안내 ──────────────────────────────────────────────────

function renderRegrant() {
  const r = regrantResult;
  const reason = r ? r.reason : "";
  const bundleId = r ? (r.bundleId || "") : "";

  return `
    <div class="card">
      <h2>AX/SR 재허용 필요</h2>
      <p class="subtitle">
        macOS TCC는 번들 ID 별로 grant 를 관리합니다. 현재 상태에서는
        <strong>AX + SR 을 다시 허용</strong>해야 합니다.
        기존 grant 가 자동으로 반영되지 않은 경우가 있습니다.
      </p>
      ${bundleId ? `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">현재 감지된 번들 ID: <code>${esc(bundleId)}</code></p>` : ""}
      ${reason ? `<p style="font-size:13px;color:var(--warn);margin-bottom:16px;">${esc(reason)}</p>` : ""}
      <div class="regrant-box">
        <strong>재허용 순서:</strong>
        <ol>
          <li>아래 버튼으로 시스템 설정 → 접근성(AX)을 열어 RemotePair 를 켭니다.</li>
          <li>화면 녹화(SR)도 동일하게 켭니다.</li>
          <li>앱을 재시작하지 않아도 약 2초 후 "권한" 스텝의 배지가 ✓ 로 바뀝니다.</li>
        </ol>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="open-ax">접근성 열기</button>
        <button class="btn btn-ghost btn-sm" id="open-sr">화면 녹화 열기</button>
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next">다음 →</button>
    </div>
  `;
}

function bindRegrant() {
  document.getElementById("open-ax")?.addEventListener("click", () =>
    apiPost("/api/permissions/open", { pane: "ax" }).catch(() => {})
  );
  document.getElementById("open-sr")?.addEventListener("click", () =>
    apiPost("/api/permissions/open", { pane: "sr" }).catch(() => {})
  );
}

// ── 클라이언트 전용 스텝: 호스트 설정 부트스트랩 안내 ────────────────────────

function renderHostGuide() {
  const bootstrapCmd = `curl -fsSL https://raw.githubusercontent.com/remote-pair/remote-pair/main/install.sh | bash -s -- --role host`;
  return `
    <div class="card">
      <h2>호스트 Mac 설정</h2>
      <p class="subtitle">
        이 Mac 은 <strong>Client</strong> 역할입니다. 연결 전 호스트 Mac 에서 아래 설치 명령을 실행하세요.<br>
        호스트가 이미 설정되어 있으면 다음 단계로 진행하세요.
      </p>
      <div class="regrant-box" style="margin-bottom:16px;">
        <strong>1. 호스트 Mac 에서 터미널을 열고 아래 명령을 실행합니다:</strong>
        <pre style="margin-top:10px;background:#1c1c1e;color:#e5e5ea;padding:12px 14px;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${esc(bootstrapCmd)}</pre>
        <button class="btn btn-ghost btn-sm" id="btn-copy-bootstrap" style="margin-top:10px;">명령 복사</button>
      </div>
      <div class="regrant-box">
        <strong>2. 설치 후 호스트 Mac 에서 권한(AX · SR)을 허용하고 앱을 실행합니다.</strong><br>
        <span style="font-size:13px;color:var(--muted);">호스트 앱이 실행 중이어야 이 클라이언트의 SSH · 폴더 동기화가 동작합니다.</span>
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next">다음 →</button>
    </div>
  `;
}

// ── 호스트 전용 스텝: 클라이언트 SSH 공개키 추가 안내 ────────────────────────

function renderClientSshSetup() {
  return `
    <div class="card">
      <h2>클라이언트 SSH 공개키 등록</h2>
      <p class="subtitle">
        클라이언트 Mac 이 이 호스트로 SSH 접속하려면 클라이언트의 공개키를 이 호스트의
        <code>~/.ssh/authorized_keys</code> 에 등록해야 합니다.
      </p>
      <div class="regrant-box">
        <strong>클라이언트에서 실행:</strong>
        <pre style="margin-top:10px;background:#1c1c1e;color:#e5e5ea;padding:12px 14px;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-all;">ssh-copy-id &lt;user@this-host&gt;</pre>
        <p style="margin-top:10px;font-size:13px;color:var(--muted);">
          또는 클라이언트 SSH 마법사 스텝에서 "ssh-copy-id 실행" 버튼을 사용하세요.<br>
          이미 등록돼 있으면 이 스텝을 건너뛰어도 됩니다.
        </p>
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next">다음 →</button>
    </div>
  `;
}

function bindHostGuide() {
  const bootstrapCmd = `curl -fsSL https://raw.githubusercontent.com/remote-pair/remote-pair/main/install.sh | bash -s -- --role host`;
  document.getElementById("btn-copy-bootstrap")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(bootstrapCmd).catch(() => {});
    const btn = document.getElementById("btn-copy-bootstrap");
    if (btn) { btn.textContent = "복사됨 ✓"; setTimeout(() => { btn.textContent = "명령 복사"; }, 1600); }
  });
}

// ── 스텝: SSH 점검 (3-sub-step + handshake gate) ─────────────────────────────
//
// 서브스텝:
//   0 — 공개키 상태 확인 + Generate Key (POST /api/ssh/keygen, GET /api/ssh/pubkey)
//   1 — 공개키 복사 안내 + Run ssh-copy-id (POST /api/ssh/copy-id)
//   2 — 검증 (GET /api/ssh-check) + handshake 게이트 (GET /api/handshake 폴링)
//
// canNextSSH: handshake.ok === true 일 때만 Next 활성화
//
// 엔드포인트 형상 가정 (브리지가 구현해야 함):
//   POST /api/ssh/keygen        → { ok, pubkey? }
//   GET  /api/ssh/pubkey        → { ok, pubkey, path }
//   POST /api/ssh/copy-id       → { ok, output?, error? }
//   GET  /api/ssh-check         → { ok, output? }
//   GET  /api/handshake         → { ok, ssh: bool, appFresh: bool, tmuxAqua: bool }

function renderSSH() {
  const host = lastStatus?.host || "";
  const role = selectedRole || (lastStatus?.role || "");

  // 호스트 미설정이면 host 입력 폼
  if (!host) {
    return `
      <div class="card">
        <h2>SSH 설정</h2>
        <p class="subtitle">
          호스트 Mac 의 SSH 주소를 먼저 지정하세요.
        </p>
        <div style="margin-top:16px;">
          <input id="host-input" placeholder="user@hostname" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;width:260px;">
          <button class="btn btn-ghost btn-sm" id="btn-set-host" style="margin-left:8px;">저장</button>
        </div>
      </div>
      <div class="nav-row">
        <button class="btn btn-ghost" id="btn-back">← 이전</button>
        <button class="btn btn-primary" id="btn-next" disabled>다음 →</button>
      </div>
    `;
  }

  return `
    <div class="card">
      <h2>SSH 연결 설정</h2>
      <p class="subtitle">
        호스트: <strong>${esc(host)}</strong> 와의 SSH 키 인증을 3단계로 설정합니다.
      </p>

      <!-- 서브스텝 탭 -->
      <div class="ssh-substep-tabs">
        <button class="ssh-stab ${sshSubStep === 0 ? "active" : ""}" data-sub="0">① 키 생성</button>
        <button class="ssh-stab ${sshSubStep === 1 ? "active" : ""}" data-sub="1">② 키 배포</button>
        <button class="ssh-stab ${sshSubStep === 2 ? "active" : ""}" data-sub="2">③ 핸드셰이크</button>
      </div>

      <!-- 서브스텝 0: 공개키 상태 + Generate -->
      <div id="ssh-sub-0" ${sshSubStep !== 0 ? "hidden" : ""}>
        <p style="font-size:13px;color:var(--muted);margin:14px 0 10px;">
          SSH 공개키 상태를 확인합니다. 키가 없으면 생성합니다.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn btn-ghost btn-sm" id="btn-check-pubkey">공개키 확인</button>
          <button class="btn btn-ghost btn-sm" id="btn-gen-key">Generate Key</button>
        </div>
        <div id="pubkey-out" class="check-output" style="display:none"></div>
      </div>

      <!-- 서브스텝 1: 공개키 표시 + ssh-copy-id -->
      <div id="ssh-sub-1" ${sshSubStep !== 1 ? "hidden" : ""}>
        <p style="font-size:13px;color:var(--muted);margin:14px 0 6px;">
          아래 공개키를 호스트의 <code>~/.ssh/authorized_keys</code> 에 추가하거나<br>
          "ssh-copy-id 실행" 버튼으로 자동 등록하세요.
        </p>
        <pre id="pubkey-display" style="background:#1c1c1e;color:#e5e5ea;padding:12px 14px;border-radius:8px;font-size:11px;white-space:pre-wrap;word-break:break-all;margin-bottom:10px;">(공개키 로딩 중...)</pre>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" id="btn-copy-pubkey">공개키 복사</button>
          <button class="btn btn-ghost btn-sm" id="btn-run-copy-id">ssh-copy-id 실행</button>
        </div>
        <div id="copy-id-out" class="check-output" style="display:none;margin-top:10px;"></div>
      </div>

      <!-- 서브스텝 2: 검증 + 핸드셰이크 배지 -->
      <div id="ssh-sub-2" ${sshSubStep !== 2 ? "hidden" : ""}>
        <p style="font-size:13px;color:var(--muted);margin:14px 0 10px;">
          SSH 연결 및 호스트 앱 상태를 실시간으로 확인합니다.
        </p>
        <button class="btn btn-ghost btn-sm" id="btn-run-verify">SSH 연결 검증</button>
        <div id="ssh-verify-out" class="check-output" style="display:none;margin-top:10px;"></div>

        <div style="margin-top:20px;">
          <div class="fa-section-title">핸드셰이크 상태 (3초마다 갱신)</div>
          <div id="handshake-badges" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <span class="badge off">– SSH</span>
            <span class="badge off">– 호스트 앱</span>
            <span class="badge off">– tmux-aqua</span>
          </div>
          <p id="handshake-hint" style="font-size:12px;color:var(--muted);margin-top:8px;">
            3가지 배지가 모두 ✓ 이면 다음으로 진행할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next" ${canNextSSH() ? "" : "disabled"}>다음 →</button>
    </div>
  `;
}

function canNextSSH() {
  // 서브스텝 2 에서 handshake.ok === true 일 때만 Next 활성
  if (sshSubStep !== 2) return false;
  return !!(lastHandshake && lastHandshake.ok === true);
}

// 핸드셰이크 폴링 제어
function _startHandshakePolling() {
  _stopHandshakePolling();
  _pollHandshake(); // 즉시 1회
  _handshakeTimer = setInterval(_pollHandshake, 3000);
}

function _stopHandshakePolling() {
  if (_handshakeTimer) { clearInterval(_handshakeTimer); _handshakeTimer = null; }
}

async function _pollHandshake() {
  try {
    lastHandshake = await apiGet("/api/handshake");
  } catch (e) {
    lastHandshake = { ok: false, ssh: false, statusFresh: false, tmuxUp: false };
  }
  _renderHandshakeBadges();
  updateNextButton();
}

function _renderHandshakeBadges() {
  const el = document.getElementById("handshake-badges");
  if (!el) return;
  const h = lastHandshake || {};
  el.innerHTML = `
    ${badge("SSH",       h.ssh         ?? null)}
    ${badge("호스트 앱", h.statusFresh ?? null)}
    ${badge("tmux-aqua", h.tmuxUp     ?? null)}
  `;
  const hint = document.getElementById("handshake-hint");
  if (hint) {
    if (h.ok) {
      hint.innerHTML = `<span style="color:var(--ok)">✓ 핸드셰이크 성공 — 다음으로 진행하세요.</span>`;
    } else {
      hint.textContent = "3가지 배지가 모두 ✓ 이면 다음으로 진행할 수 있습니다.";
    }
  }
}

async function loadSSH() {
  const host = lastStatus?.host || "";

  // 호스트 미설정 — 저장 버튼만 바인딩
  if (!host) {
    const btnSet = document.getElementById("btn-set-host");
    if (btnSet) {
      btnSet.addEventListener("click", async () => {
        const val = document.getElementById("host-input")?.value?.trim();
        if (!val) return;
        try {
          await apiPost("/api/config", { key: "host", value: val });
          renderCurrentStep();
        } catch (e) {
          alert(`저장 실패: ${e.message}`);
        }
      });
    }
    return;
  }

  // 부트스트랩 복사 버튼 (host-guide 스텝에서도 바인딩되지만 ssh 안에서도 있을 수 있음)
  document.getElementById("btn-copy-bootstrap")?.addEventListener("click", () => {
    const cmd = document.querySelector("#btn-copy-bootstrap")?.previousElementSibling?.textContent?.trim() || "";
    navigator.clipboard?.writeText(cmd).catch(() => {});
  });

  // ── 서브스텝 탭 전환 ──
  document.querySelectorAll(".ssh-stab").forEach(btn => {
    btn.addEventListener("click", () => {
      sshSubStep = parseInt(btn.dataset.sub, 10);
      // 서브스텝 2 진입 시 핸드셰이크 폴링 시작
      if (sshSubStep === 2) _startHandshakePolling();
      else _stopHandshakePolling();
      renderCurrentStep();
    });
  });

  // ── 서브스텝 0 바인딩 ──
  document.getElementById("btn-check-pubkey")?.addEventListener("click", async () => {
    const out = document.getElementById("pubkey-out");
    if (out) { out.style.display = "block"; out.textContent = "확인 중..."; out.style.color = ""; }
    try {
      const r = await apiGet("/api/ssh/pubkey");
      if (out) {
        if (r.exists && r.pubkey) {
          out.textContent = `경로: ${r.keyPath || "~/.ssh/id_ed25519.pub"}\n\n${r.pubkey}`;
          out.style.color = "#34c759";
        } else {
          out.textContent = "공개키가 없습니다. Generate Key 버튼으로 생성하세요.";
          out.style.color = "#ff9f0a";
        }
      }
    } catch (e) {
      if (out) { out.textContent = `오류: ${e.message}`; out.style.color = "#ff3b30"; }
    }
  });

  document.getElementById("btn-gen-key")?.addEventListener("click", async () => {
    const out = document.getElementById("pubkey-out");
    if (out) { out.style.display = "block"; out.textContent = "키 생성 중..."; out.style.color = ""; }
    try {
      const r = await apiPost("/api/ssh/keygen", {});
      if (out) {
        if (r.ok) {
          out.textContent = `키 생성 완료!\n\n${r.pubkey || "(키 생성됨 — 공개키 확인 버튼으로 조회)"}`;
          out.style.color = "#34c759";
        } else {
          out.textContent = `생성 실패: ${r.error || "알 수 없는 오류"}`;
          out.style.color = "#ff3b30";
        }
      }
    } catch (e) {
      if (out) { out.textContent = `오류: ${e.message}`; out.style.color = "#ff3b30"; }
    }
  });

  // ── 서브스텝 1 바인딩 ──
  // 서브스텝 1이 보일 때 공개키 자동 로드
  if (sshSubStep === 1) {
    const disp = document.getElementById("pubkey-display");
    if (disp) {
      apiGet("/api/ssh/pubkey").then(r => {
        if (r.exists && r.pubkey) disp.textContent = r.pubkey;
        else disp.textContent = "(공개키 없음 — ① 키 생성 탭에서 Generate Key 를 먼저 실행하세요)";
      }).catch(e => { disp.textContent = `로드 실패: ${e.message}`; });
    }
  }

  document.getElementById("btn-copy-pubkey")?.addEventListener("click", async () => {
    const disp = document.getElementById("pubkey-display");
    const text = disp?.textContent?.trim() || "";
    if (text && !text.startsWith("(")) {
      await navigator.clipboard?.writeText(text).catch(() => {});
      const btn = document.getElementById("btn-copy-pubkey");
      if (btn) { btn.textContent = "복사됨 ✓"; setTimeout(() => { btn.textContent = "공개키 복사"; }, 1500); }
    } else {
      alert("복사할 공개키가 없습니다. 먼저 ① 키 생성 탭에서 키를 생성하세요.");
    }
  });

  document.getElementById("btn-run-copy-id")?.addEventListener("click", async () => {
    const out = document.getElementById("copy-id-out");
    if (out) { out.style.display = "block"; out.textContent = "ssh-copy-id 실행 중..."; out.style.color = ""; }
    try {
      const r = await apiPost("/api/ssh/copy-id", { host });
      if (out) {
        out.textContent = r.ok ? (r.output || "성공") : `실패: ${r.error || ""}`;
        out.style.color = r.ok ? "#34c759" : "#ff3b30";
      }
    } catch (e) {
      if (out) { out.textContent = `오류: ${e.message}`; out.style.color = "#ff3b30"; }
    }
  });

  // ── 서브스텝 2 바인딩 ──
  document.getElementById("btn-run-verify")?.addEventListener("click", async () => {
    const out = document.getElementById("ssh-verify-out");
    if (out) { out.style.display = "block"; out.textContent = "검증 중..."; out.style.color = ""; }
    try {
      sshResult = await apiGet("/api/ssh-check");
      if (out) {
        out.textContent = sshResult.output || (sshResult.ok ? "연결 성공" : "연결 실패");
        out.style.color = sshResult.ok ? "#34c759" : "#ff9f0a";
      }
    } catch (e) {
      if (out) { out.textContent = `오류: ${e.message}`; out.style.color = "#ff3b30"; }
    }
  });

  // 서브스텝 2 에 있으면 핸드셰이크 폴링 즉시 시작
  if (sshSubStep === 2) {
    _startHandshakePolling();
  }
}

// ── 스텝 4: 파일 접근 방식 선택 + 폴더 매핑 ──────────────────────────────────
//
// 두 가지 방식:
//   Syncthing — 로컬 복사본, 낮은 편집 지연, 동기화 데몬 필요
//   Mount     — 단일 소스(호스트), 충돌 없음, SMB 또는 SSHFS 백엔드

function renderMaps() {
  const isSyncthing = fileAccessBackend === "syncthing";
  const isMount     = fileAccessBackend === "mount";

  return `
    <div class="card">
      <h2>파일 접근 방식</h2>
      <p class="subtitle">
        호스트 Mac 의 파일에 접근하는 방법을 선택합니다.
        자세한 트레이드오프는 <code>docs/m-mount.md</code> 를 참고하세요.
      </p>

      <!-- 백엔드 선택 라디오 -->
      <div class="fa-choice-grid">
        <label class="fa-choice ${isSyncthing ? "selected" : ""}" id="fa-lbl-syncthing">
          <input type="radio" name="fa-backend" value="syncthing" ${isSyncthing ? "checked" : ""}>
          <div class="fa-choice-body">
            <strong>Syncthing (기본)</strong>
            <p>로컬 복사본 — 편집 지연 없음, 동기화 데몬 필요, 충돌 파일 가능성 있음.</p>
          </div>
        </label>
        <label class="fa-choice ${isMount ? "selected" : ""}" id="fa-lbl-mount">
          <input type="radio" name="fa-backend" value="mount" ${isMount ? "checked" : ""}>
          <div class="fa-choice-body">
            <strong>Mount (단일 소스)</strong>
            <p>호스트 직접 마운트 — 동기화 데몬 없음, 충돌 제로, 네트워크 왕복 지연 있음 (SMB: LAN ~1-5 ms).</p>
          </div>
        </label>
      </div>

      <!-- Syncthing 섹션 -->
      <div id="fa-syncthing-section" ${isMount ? 'hidden' : ''}>
        <div class="fa-section-title">폴더 매핑 (Syncthing)</div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:10px;">
          클라이언트 폴더와 호스트 폴더를 연결합니다. 호스트 경로를 비우면 동일 경로로 등록합니다.
        </p>
        <ul class="map-list" id="map-list">
          <li style="color:var(--muted);font-size:13px;">불러오는 중...</li>
        </ul>
        <div class="add-map-form">
          <input id="client-dir" placeholder="클라이언트 경로 (예: ~/Spaces/myproject)">
          <input id="host-dir"   placeholder="호스트 경로 (비우면 동일 경로)">
          <button class="btn btn-ghost btn-sm" id="btn-add-map">추가</button>
        </div>
      </div>

      <!-- Mount 섹션 -->
      <div id="fa-mount-section" ${isSyncthing ? 'hidden' : ''}>
        <div class="fa-section-title">마운트 백엔드</div>
        <div class="fa-mount-backends">
          <label class="fa-mb ${mountBackend === "smb" ? "selected" : ""}">
            <input type="radio" name="mb-backend" value="smb" ${mountBackend === "smb" ? "checked" : ""}>
            <div>
              <strong>SMB (기본, 커널 확장 불필요)</strong>
              <p>macOS 내장. 호스트에서 System Settings &gt; General &gt; Sharing &gt; File Sharing 을 활성화하세요.</p>
            </div>
          </label>
          <label class="fa-mb ${mountBackend === "sshfs" ? "selected" : ""}">
            <input type="radio" name="mb-backend" value="sshfs" ${mountBackend === "sshfs" ? "checked" : ""}>
            <div>
              <strong>SSHFS (SSH 재사용, macFUSE 필요)</strong>
              <p>기존 SSH 키 재사용. 클라이언트에 <code>brew install --cask macfuse</code> + <code>brew install gromgit/fuse/sshfs-mac</code> 필요.</p>
            </div>
          </label>
        </div>

        <div style="margin-top:16px;">
          <div class="fa-section-title">마운트 실행</div>
          <div class="add-map-form">
            <input id="mount-host-path" placeholder="호스트 경로 (예: /Users/alice/Projects/foo)">
            <input id="mount-mountpoint" placeholder="로컬 마운트 포인트 (비우면 자동)">
            <button class="btn btn-ghost btn-sm" id="btn-do-mount">마운트</button>
          </div>
          <div id="mount-out" style="display:none" class="check-output"></div>
        </div>

        <div style="margin-top:14px;">
          <div class="fa-section-title">현재 마운트 상태</div>
          <div id="mount-status-area" style="font-size:13px;color:var(--muted);margin-top:6px;">확인 중...</div>
          <button class="btn btn-ghost btn-sm" id="btn-refresh-mounts" style="margin-top:8px;">새로고침</button>
        </div>
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next">다음 →</button>
    </div>
  `;
}

async function loadFileAccess() {
  // 현재 저장된 백엔드 설정 읽기
  try {
    const cfg = await apiGet("/api/sync-backend");
    if (cfg.syncBackend) fileAccessBackend = cfg.syncBackend;
    if (cfg.mountBackend) mountBackend = cfg.mountBackend;
  } catch (e) { /* graceful */ }

  // 라디오 선택 반영 (서버에서 읽어온 값으로 재렌더할 필요 없음 — 변수 이미 설정됨)
  _updateFaRadios();

  // Syncthing 섹션 이벤트
  await refreshMapList();
  document.getElementById("btn-add-map")?.addEventListener("click", async () => {
    const clientDir = document.getElementById("client-dir")?.value?.trim();
    const hostDir   = document.getElementById("host-dir")?.value?.trim();
    if (!clientDir) { alert("클라이언트 경로를 입력하세요."); return; }
    try {
      await apiPost("/api/map", { action: "add", clientDir, hostDir: hostDir || undefined });
      document.getElementById("client-dir").value = "";
      document.getElementById("host-dir").value   = "";
      await refreshMapList();
    } catch (e) {
      alert(`추가 실패: ${e.message}`);
    }
  });

  // Mount 섹션 이벤트
  await refreshMountStatus();
  document.getElementById("btn-refresh-mounts")?.addEventListener("click", refreshMountStatus);
  document.getElementById("btn-do-mount")?.addEventListener("click", async () => {
    const hostPath   = document.getElementById("mount-host-path")?.value?.trim();
    const mountpoint = document.getElementById("mount-mountpoint")?.value?.trim();
    const outEl = document.getElementById("mount-out");
    if (!hostPath) { alert("호스트 경로를 입력하세요."); return; }
    if (outEl) { outEl.style.display = "block"; outEl.textContent = "마운트 중..."; }
    try {
      const r = await apiPost("/api/mount/mount", { hostPath, mountpoint: mountpoint || undefined });
      if (outEl) {
        outEl.textContent = r.ok ? (r.output || "마운트 완료") : `실패: ${r.error || ""}`;
        outEl.style.color = r.ok ? "#34c759" : "#ff3b30";
      }
      if (r.ok) await refreshMountStatus();
    } catch (e) {
      if (outEl) { outEl.textContent = `실패: ${e.message}`; outEl.style.color = "#ff3b30"; }
    }
  });

  // 파일 접근 방식 라디오 전환
  document.querySelectorAll("input[name='fa-backend']").forEach(radio => {
    radio.addEventListener("change", async () => {
      fileAccessBackend = radio.value;
      _toggleFaSections();
      _updateFaChoiceStyles();
      await _saveSyncBackend();
    });
  });

  // 마운트 백엔드 라디오 전환
  document.querySelectorAll("input[name='mb-backend']").forEach(radio => {
    radio.addEventListener("change", async () => {
      mountBackend = radio.value;
      _updateMbStyles();
      await _saveSyncBackend();
    });
  });
}

function _updateFaRadios() {
  // 이미 렌더된 라디오에 현재 변수 값 반영
  const stRadio = document.querySelector("input[name='fa-backend'][value='syncthing']");
  const mtRadio = document.querySelector("input[name='fa-backend'][value='mount']");
  if (stRadio) stRadio.checked = fileAccessBackend === "syncthing";
  if (mtRadio) mtRadio.checked = fileAccessBackend === "mount";
  const smbRadio  = document.querySelector("input[name='mb-backend'][value='smb']");
  const sshfsRadio = document.querySelector("input[name='mb-backend'][value='sshfs']");
  if (smbRadio)   smbRadio.checked   = mountBackend === "smb";
  if (sshfsRadio) sshfsRadio.checked = mountBackend === "sshfs";
  _toggleFaSections();
  _updateFaChoiceStyles();
  _updateMbStyles();
}

function _toggleFaSections() {
  const stSec = document.getElementById("fa-syncthing-section");
  const mtSec = document.getElementById("fa-mount-section");
  if (stSec) stSec.hidden = fileAccessBackend !== "syncthing";
  if (mtSec) mtSec.hidden = fileAccessBackend !== "mount";
}

function _updateFaChoiceStyles() {
  document.querySelectorAll(".fa-choice").forEach(lbl => {
    const radio = lbl.querySelector("input[type='radio']");
    lbl.classList.toggle("selected", radio && radio.checked);
  });
}

function _updateMbStyles() {
  document.querySelectorAll(".fa-mb").forEach(lbl => {
    const radio = lbl.querySelector("input[type='radio']");
    lbl.classList.toggle("selected", radio && radio.checked);
  });
}

async function _saveSyncBackend() {
  try {
    await apiPost("/api/sync-backend", { syncBackend: fileAccessBackend, mountBackend });
  } catch (e) { /* graceful */ }
}

async function refreshMapList() {
  const listEl = document.getElementById("map-list");
  if (!listEl) return;

  try {
    mapsResult = await apiGet("/api/map");
    const maps = mapsResult.maps || [];
    if (maps.length === 0) {
      listEl.innerHTML = `<li style="color:var(--muted);font-size:13px;">(매핑 없음)</li>`;
      return;
    }
    listEl.innerHTML = maps.map(m => `
      <li class="map-item">
        <span style="font-size:12px">${esc(m.client)}</span>
        <span class="arrow">→</span>
        <span style="font-size:12px">${esc(m.host)}</span>
        <button class="map-rm-btn" data-client="${esc(m.client)}" title="매핑 삭제">×</button>
      </li>
    `).join("");

    listEl.querySelectorAll(".map-rm-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const clientDir = btn.dataset.client;
        if (!confirm(`매핑을 삭제할까요?\n${clientDir}`)) return;
        try {
          await apiPost("/api/map", { action: "rm", clientDir });
          await refreshMapList();
        } catch (e) {
          alert(`삭제 실패: ${e.message}`);
        }
      });
    });
  } catch (e) {
    listEl.innerHTML = `<li style="color:var(--err);font-size:13px;">로드 실패: ${e.message}</li>`;
  }
}

async function refreshMountStatus() {
  const el = document.getElementById("mount-status-area");
  if (!el) return;
  try {
    mountResult = await apiGet("/api/mount/status");
    if (!mountResult.launcherFound) {
      el.innerHTML = `<span class="badge off">– remote-pair-mount 런처 없음</span>
        <p style="margin-top:6px;font-size:12px;color:var(--muted);">
          <code>install.sh --role client</code> 를 실행하여 런처를 설치하세요.
        </p>`;
      return;
    }
    const mounts = mountResult.mounts || [];
    if (mounts.length === 0) {
      el.innerHTML = `<span class="badge off">– 활성 마운트 없음</span>`;
    } else {
      el.innerHTML = `<span class="badge ok">✓ ${mounts.length}개 마운트 활성</span>
        <ul style="margin-top:8px;list-style:none;padding:0;display:flex;flex-direction:column;gap:4px;">
          ${mounts.map(m => `
            <li class="map-item" style="justify-content:space-between;">
              <span style="font-size:12px;font-family:'SF Mono',Menlo,monospace;">${esc(m)}</span>
              <button class="map-rm-btn" data-target="${esc(m)}" title="언마운트">×</button>
            </li>`).join("")}
        </ul>`;
      el.querySelectorAll(".map-rm-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const target = btn.dataset.target;
          if (!confirm(`언마운트할까요?\n${target}`)) return;
          try {
            const r = await apiPost("/api/mount/unmount", { target });
            if (!r.ok) alert(`언마운트 실패: ${r.error || ""}`);
            await refreshMountStatus();
          } catch (e) {
            alert(`언마운트 실패: ${e.message}`);
          }
        });
      });
    }
  } catch (e) {
    el.innerHTML = `<span class="badge off">– 확인 실패: ${esc(e.message)}</span>`;
  }
}

// ── 스텝 5: Syncthing 헬스 ───────────────────────────────────────────────────

function renderSyncthing() {
  return `
    <div class="card">
      <h2>Syncthing 헬스</h2>
      <p class="subtitle">
        Syncthing 은 폴더 동기화를 담당하는 외부 도구입니다 (선택 사항).<br>
        미설치 또는 중지 상태여도 진행할 수 있습니다.
      </p>
      <div id="sync-status" style="margin-top:8px;color:var(--muted);font-size:14px;">
        확인 중...
      </div>
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 이전</button>
      <button class="btn btn-primary" id="btn-next">다음 →</button>
    </div>
  `;
}

async function loadSyncthing() {
  const el = document.getElementById("sync-status");
  if (!el) return;
  try {
    syncResult = await apiGet("/api/syncthing");
    if (syncResult.detected && syncResult.status === "up") {
      el.innerHTML = `<span class="badge ok">✓ Syncthing 실행 중</span>`;
    } else {
      el.innerHTML = `
        <span class="badge off">– not detected</span>
        <p style="margin-top:10px;font-size:13px;color:var(--muted);">
          Syncthing 이 감지되지 않았습니다. 필요하다면
          <a href="https://syncthing.net" target="_blank" rel="noopener">syncthing.net</a>
          에서 설치하세요. 이 마법사는 Syncthing 없이도 계속 진행됩니다.
        </p>
      `;
    }
  } catch (e) {
    el.innerHTML = `<span class="badge off">– 확인 실패: ${e.message}</span>`;
  }
}

// ── 스텝: 검증 / 완료 ────────────────────────────────────────────────────────

function renderVerify() {
  const s = lastStatus || {};
  const role = selectedRole || s.role || "";
  const clientMode = isClient(role);
  const h = lastHandshake || {};

  // client 모드는 AX/SR 불필요
  const allGood = clientMode
    ? (s.appUp && h.ok)
    : (s.appUp && s.ax && s.sr);

  const rows = [
    { icon: s.appUp ? "✅" : "❌", label: "앱 상태",   val: s.appUp ? "실행 중" : "중지됨 (앱을 실행하세요)" },
  ];

  if (!clientMode) {
    rows.push(
      { icon: s.ax  ? "✅" : "❌", label: "AX 권한",  val: s.ax  ? "허용됨" : "미허용" },
      { icon: s.sr  ? "✅" : "❌", label: "SR 권한",  val: s.sr  ? "허용됨" : "미허용" },
      { icon: s.fda ? "✅" : "⬜", label: "FDA 권한", val: s.fda ? "허용됨" : "미허용 (선택)" },
    );
  }

  rows.push(
    { icon: s.role  ? "✅" : "⬜", label: "역할",      val: s.role  || "(미설정)" },
    { icon: s.host  ? "✅" : "⬜", label: "Host",      val: s.host  || "(로컬 전용)" },
    {
      icon: h.ok ? "✅" : (h.ssh !== undefined ? "❌" : "⬜"),
      label: "핸드셰이크",
      val: h.ok
        ? "성공 (SSH ✓ · 앱 ✓ · tmux ✓)"
        : (h.ssh !== undefined
            ? `미완 (SSH:${h.ssh?"✓":"✗"} 앱:${h.appFresh?"✓":"✗"} tmux:${h.tmuxAqua?"✓":"✗"})`
            : "미확인 (SSH 스텝 완료 후 갱신)"),
    },
    { icon: "📁",                  label: "폴더 매핑", val: `${(s.maps||[]).length}개` },
    {
      icon: syncResult?.detected ? "✅" : "⬜",
      label: "Syncthing",
      val: fileAccessBackend === "mount" ? "건너뜀 (Mount 모드)" : (syncResult?.status || "미확인"),
    },
    {
      icon: fileAccessBackend === "mount" ? "✅" : "⬜",
      label: "파일 접근",
      val: fileAccessBackend === "mount" ? `Mount (${mountBackend})` : "Syncthing",
    },
  );

  return `
    <div class="card">
      <h2>설정 요약</h2>
      <p class="subtitle">모든 항목을 확인하세요.</p>
      <div class="summary-grid">
        ${rows.map(r => `
          <div class="summary-row">
            <span class="s-icon">${r.icon}</span>
            <span class="s-label">${esc(r.label)}</span>
            <span class="s-val">${esc(r.val)}</span>
          </div>
        `).join("")}
      </div>
      ${allGood ? `
        <div class="finish-hero">
          <div class="big-check">🎉</div>
          <p>설정 완료! <code>remote-pair launch &lt;폴더&gt;</code> 로 세션을 시작하세요.</p>
        </div>
      ` : `
        <div class="perm-note">
          ⚠ 일부 항목이 누락되었습니다. 이전 스텝으로 돌아가 확인하세요.
        </div>
      `}
    </div>
    <div class="nav-row">
      <button class="btn btn-ghost" id="btn-back">← 처음으로</button>
    </div>
  `;
}

async function loadVerify() {
  // Syncthing 결과가 없으면 여기서 로드
  if (!syncResult) {
    try { syncResult = await apiGet("/api/syncthing"); } catch (e) { /* ignore */ }
    renderCurrentStep();
  }
}

// ── 마법사 초기화 (router 가 호출) ────────────────────────────────────────────

let _wizardStarted = false;

function startWizard() {
  // 라우터가 wizard 뷰로 전환할 때 호출. 폴링은 한 번만 시작.
  currentStep = currentStep || 0;

  // activeSteps 가 아직 없으면 서버 role(또는 selectedRole)로 초기화
  if (!activeSteps || activeSteps.length === 0) {
    const role = selectedRole || (lastStatus && lastStatus.role) || "";
    if (role) selectedRole = role;
    activeSteps = buildSteps(role);
  }

  renderCurrentStep();
  if (!_wizardStarted) {
    _wizardStarted = true;
    startPolling();
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   RemotePair APP SHELL
   좌: 터미널 탭(iTerm식) + 파일/역할 / 우: Remote Desktop · Editor 탭
   + 알림 패널 + 설정 패널. 모두 token-gated 로컬 브리지 위에서 동작.
   wizard 와 동일한 api()/apiGet()/apiPost()/TOKEN/lastStatus 를 재사용한다.
   ════════════════════════════════════════════════════════════════════════════ */

// ── 라우터 (wizard ↔ shell) ───────────────────────────────────────────────────
// 규칙:
//   - #wizard           → 마법사
//   - 그 외(첫 진입)     → 역할 미설정이면 마법사, 설정돼 있으면 shell
// 사용자는 상단의 🧭 버튼으로 언제든 마법사를 다시 열 수 있다.

let _shellStarted = false;

function showView(view) {
  const wiz   = document.getElementById("wizard-root");
  const shell = document.getElementById("shell-root");
  if (!wiz || !shell) return;
  if (view === "wizard") {
    wiz.hidden = false;
    shell.hidden = true;
    startWizard();
  } else {
    wiz.hidden = true;
    shell.hidden = false;
    startShell();
  }
}

async function route() {
  if (window.location.hash === "#wizard") {
    showView("wizard");
    return;
  }
  // 첫 진입 판단: role 이 설정돼 있으면 곧장 shell.
  let role = "";
  try {
    const s = await apiGet("/api/status");
    lastStatus = s;
    role = s.role || "";
  } catch (e) { /* 브리지 미응답 — shell 로 가서 안내 */ }
  showView(role ? "shell" : "wizard");
}

// ── 공통: 토큰 가드 ───────────────────────────────────────────────────────────
function bootGuard() {
  if (!TOKEN) {
    document.body.innerHTML = `
      <div style="padding:60px;text-align:center;color:#ff3b30;font-size:18px;">
        토큰이 없습니다. <code>remote-pair web</code> 명령으로 시작하세요.
      </div>`;
    return false;
  }
  return true;
}

// ── 앱 부트 ───────────────────────────────────────────────────────────────────
function boot() {
  if (!bootGuard()) return;
  window.addEventListener("hashchange", route);
  route();
}

document.addEventListener("DOMContentLoaded", boot);


/* ──────────────────────────────────────────────────────────────────────────
   SHELL 상태
─────────────────────────────────────────────────────────────────────────── */

const shell = {
  sessions: [],          // [{name, attached}]
  activeSession: null,   // 현재 보고 있는 세션명
  terms: {},             // session -> {term, fitCols, fitRows, lastOutput, usingXterm}
  outputTimer: null,     // 활성 세션 output 폴링 타이머
  listTimer: null,       // 세션목록 폴링 타이머
  notifTimer: null,      // 알림 폴링 타이머
  notifEvents: [],       // 누적 표시된 알림
  unseen: 0,             // 미확인 알림 수
  editorTimer: null,     // 에디터 상태 폴링
  started: false,
};

function startShell() {
  renderRightTab("desktop");        // 우측 기본 탭
  bindShellChrome();
  if (shell.started) return;
  shell.started = true;

  refreshSessions();
  shell.listTimer  = setInterval(refreshSessions, 4000);
  shell.notifTimer = setInterval(pollNotifications, 3000);
  pollNotifications();

  // shell 배지바도 status 폴링으로 갱신 (wizard 와 공유)
  if (!_shellStarted) {
    _shellStarted = true;
    pollShellStatus();
    setInterval(pollShellStatus, 2000);
  }
}

// ── 상단 배지 바 ──────────────────────────────────────────────────────────────
async function pollShellStatus() {
  try {
    const s = await apiGet("/api/status");
    lastStatus = s;
    renderShellBadges(s);
    renderLeftMeta(s);
  } catch (e) { /* ignore */ }
}

function shellBadge(label, ok) {
  const cls = ok === null || ok === undefined ? "off" : ok ? "ok" : "err";
  const icon = cls === "off" ? "–" : ok ? "✓" : "✗";
  return `<span class="badge ${cls}">${icon} ${label}</span>`;
}

function renderShellBadges(s) {
  const el = document.getElementById("shell-badges");
  if (!el) return;
  el.innerHTML = `
    ${shellBadge("앱", s.appUp)}
    ${shellBadge("AX", s.ax)}
    ${shellBadge("SR", s.sr)}
    ${s.host ? `<span class="badge off">${esc(s.host)}</span>` : `<span class="badge off">로컬</span>`}
    ${s.role ? `<span class="badge off">${esc(s.role)}</span>` : ""}
  `;
}

function renderLeftMeta(s) {
  const el = document.getElementById("left-meta");
  if (!el) return;
  const maps = (s.maps || []);
  el.innerHTML = `
    <div class="meta-row"><span class="meta-k">역할</span><span class="meta-v">${esc(s.role || "(미설정)")}</span></div>
    <div class="meta-row"><span class="meta-k">Host</span><span class="meta-v">${esc(s.host || "로컬 전용")}</span></div>
    <div class="meta-block">
      <div class="meta-k">폴더 매핑 (${maps.length})</div>
      <ul class="meta-maps">
        ${maps.length
          ? maps.map(m => `<li title="${esc(m.client)} → ${esc(m.host)}">${esc(shortPath(m.client))} <span class="arrow">→</span> ${esc(shortPath(m.host))}</li>`).join("")
          : `<li class="muted-note">매핑 없음 — 🧭 마법사에서 추가</li>`}
      </ul>
    </div>
  `;
}

// ── 상단 chrome (알림/설정/마법사 버튼) ───────────────────────────────────────
let _chromeBound = false;
function bindShellChrome() {
  if (_chromeBound) return;
  _chromeBound = true;

  document.getElementById("btn-open-wizard")?.addEventListener("click", () => {
    window.location.hash = "#wizard";
  });
  document.getElementById("btn-open-notif")?.addEventListener("click", openNotifDrawer);
  document.getElementById("btn-open-settings")?.addEventListener("click", openSettingsDrawer);
  document.getElementById("notif-close")?.addEventListener("click", closeDrawers);
  document.getElementById("settings-close")?.addEventListener("click", closeDrawers);
  document.getElementById("drawer-backdrop")?.addEventListener("click", closeDrawers);
  document.getElementById("notif-mark-seen")?.addEventListener("click", markNotificationsSeen);
  document.getElementById("term-refresh")?.addEventListener("click", refreshSessions);

  // 우측 탭 전환
  document.querySelectorAll(".rtab").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".rtab").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderRightTab(b.dataset.rtab);
    });
  });

  // 좌우 split 드래그
  initSplit();
}

// ── 작은 유틸 ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shortPath(p) {
  if (!p) return "";
  const parts = String(p).split("/").filter(Boolean);
  return parts.length <= 2 ? p : ".../" + parts.slice(-2).join("/");
}

/* ──────────────────────────────────────────────────────────────────────────
   M3 — 터미널 탭
─────────────────────────────────────────────────────────────────────────── */

const HAS_XTERM = typeof window.Terminal !== "undefined";

async function refreshSessions() {
  let res;
  try {
    res = await apiGet("/api/term/list");
  } catch (e) {
    renderTermTabs([], `세션 목록 실패: ${e.message}`);
    return;
  }
  // _keeper 등 내부 세션 숨김
  const sessions = (res.sessions || []).filter(s => s.name && !s.name.startsWith("_"));
  shell.sessions = sessions;
  renderTermTabs(sessions, res.note);

  // 활성 세션 정합성 유지
  if (sessions.length === 0) {
    shell.activeSession = null;
    stopOutputPolling();
  } else if (!shell.activeSession || !sessions.find(s => s.name === shell.activeSession)) {
    selectSession(sessions[0].name);
  }
}

function renderTermTabs(sessions, note) {
  const tabs = document.getElementById("term-tabs");
  const empty = document.getElementById("term-empty");
  if (!tabs) return;

  tabs.innerHTML = sessions.map(s => `
    <button class="term-tab ${s.name === shell.activeSession ? "active" : ""}"
            data-session="${esc(s.name)}" title="${esc(s.name)}">
      <span class="tab-dot ${s.attached ? "on" : ""}"></span>
      <span class="tab-label">${esc(tabLabel(s.name))}</span>
      <span class="tab-x" data-close="${esc(s.name)}" title="탭 닫기 (세션은 유지)">✕</span>
    </button>
  `).join("");

  tabs.querySelectorAll(".term-tab").forEach(b => {
    b.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("tab-x")) return; // 닫기는 별도
      selectSession(b.dataset.session);
    });
  });
  tabs.querySelectorAll(".tab-x").forEach(x => {
    x.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeTab(x.dataset.close);   // 뷰만 닫음 — kill-session 안 함
    });
  });

  if (empty) {
    if (sessions.length === 0) {
      empty.hidden = false;
      empty.innerHTML = note
        ? `세션이 없습니다. <code>remote-pair launch &lt;폴더&gt;</code> 로 시작하세요.<br><small class="muted-note">${esc(note)}</small>`
        : `세션이 없습니다. <code>remote-pair launch &lt;폴더&gt;</code> 로 시작하세요.`;
    } else {
      empty.hidden = true;
    }
  }
}

// 세션명 gh-mac-m1_proj_hash_N → 보기 좋은 짧은 라벨
function tabLabel(name) {
  const parts = name.split("_");
  if (parts.length >= 2) {
    const proj = parts.slice(1, -2).join("_") || parts[1];
    const n = parts[parts.length - 1];
    return /^\d+$/.test(n) ? `${proj} #${n}` : proj;
  }
  return name;
}

function selectSession(name) {
  if (shell.activeSession === name) return;
  shell.activeSession = name;
  // 탭 active 표시 갱신
  document.querySelectorAll(".term-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.session === name));
  mountTerminal(name);
  startOutputPolling();
}

// 탭(뷰)만 닫는다. 세션은 host 에 그대로 유지 (no kill-session).
function closeTab(name) {
  // 뷰 캐시 제거 + 다른 세션으로 전환
  if (shell.terms[name]) {
    try { shell.terms[name].term && shell.terms[name].term.dispose && shell.terms[name].term.dispose(); } catch (e) {}
    delete shell.terms[name];
  }
  // 목록에서 시각적으로만 빼되, 다음 refreshSessions 가 host 기준으로 다시 채움.
  shell.sessions = shell.sessions.filter(s => s.name !== name);
  if (shell.activeSession === name) {
    shell.activeSession = null;
    stopOutputPolling();
    const next = shell.sessions[0];
    if (next) selectSession(next.name);
    else clearTerminalHost();
  }
  renderTermTabs(shell.sessions);
}

function clearTerminalHost() {
  const host = document.getElementById("term-host");
  if (!host) return;
  host.innerHTML = `<div class="empty-hint">표시할 세션이 없습니다. 탭을 선택하거나 새 세션을 시작하세요.</div>`;
}

// 활성 세션용 터미널 마운트 (xterm.js 또는 <pre> fallback)
function mountTerminal(name) {
  const host = document.getElementById("term-host");
  if (!host) return;
  host.innerHTML = `<div class="term-view" id="term-view"></div>`;
  const view = document.getElementById("term-view");

  let entry = shell.terms[name];
  if (!entry) {
    entry = { term: null, usingXterm: HAS_XTERM, lastOutput: "" };
    shell.terms[name] = entry;
  }

  if (HAS_XTERM) {
    const term = new window.Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: false,
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: 12,
      theme: { background: "#1c1c1e", foreground: "#e5e5ea" },
      scrollback: 2000,
    });
    term.open(view);
    entry.term = term;
    entry.usingXterm = true;

    // 입력 → /api/term/input. xterm 의 onData 는 키 입력 시퀀스를 raw 로 준다.
    term.onData(data => sendTerminalData(name, data));

    // 크기 추정 → resize 알림 (대략적 — fit addon 미사용, 컨테이너 기준 계산)
    const cols = Math.max(20, Math.floor(view.clientWidth / 7.2));
    const rows = Math.max(6, Math.floor(view.clientHeight / 16));
    term.resize(cols, rows);
    apiPost("/api/term/resize", { session: name, cols, rows }).catch(() => {});
  } else {
    // fallback: <pre> + 입력창. capture-pane 폴링 결과를 그대로 렌더.
    view.innerHTML = `
      <pre class="term-pre" id="term-pre"></pre>
      <div class="term-input-row">
        <input id="term-input" placeholder="입력 후 Enter…" autocomplete="off" spellcheck="false">
      </div>`;
    const inp = document.getElementById("term-input");
    inp?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        const val = inp.value;
        inp.value = "";
        apiPost("/api/term/input", { session: name, data: val, enter: true }).catch(() => {});
        setTimeout(() => pollOutputOnce(true), 120);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        apiPost("/api/term/key", { session: name, key: "Tab" }).catch(() => {});
        setTimeout(() => pollOutputOnce(true), 120);
      } else if (ev.ctrlKey && ev.key.length === 1) {
        ev.preventDefault();
        apiPost("/api/term/key", { session: name, key: `C-${ev.key.toLowerCase()}` }).catch(() => {});
        setTimeout(() => pollOutputOnce(true), 120);
      }
    });
    entry.usingXterm = false;
  }

  entry.lastOutput = "";
  pollOutputOnce(true);  // 즉시 1회
}

// xterm onData → 키/문자. 제어키는 매핑, 일반 문자는 literal.
function sendTerminalData(name, data) {
  // 단순 처리: 캐리지리턴은 Enter 로, 그 외는 literal data 로 보낸다.
  // (대부분의 키 시퀀스는 host pty 가 해석하므로 literal 로 충분히 동작.)
  if (data === "\r") {
    apiPost("/api/term/key", { session: name, key: "Enter" }).catch(() => {});
  } else if (data === "\x7f") {
    apiPost("/api/term/key", { session: name, key: "BSpace" }).catch(() => {});
  } else if (data === "\t") {
    apiPost("/api/term/key", { session: name, key: "Tab" }).catch(() => {});
  } else if (data === "\x1b") {
    apiPost("/api/term/key", { session: name, key: "Escape" }).catch(() => {});
  } else {
    apiPost("/api/term/input", { session: name, data }).catch(() => {});
  }
  setTimeout(() => pollOutputOnce(true), 100);
}

// 활성 세션 output 폴링 (~300ms)
function startOutputPolling() {
  stopOutputPolling();
  shell.outputTimer = setInterval(() => pollOutputOnce(false), 300);
}
function stopOutputPolling() {
  if (shell.outputTimer) { clearInterval(shell.outputTimer); shell.outputTimer = null; }
}

async function pollOutputOnce(force) {
  const name = shell.activeSession;
  if (!name) return;
  let res;
  try {
    res = await apiGet(`/api/term/output?session=${encodeURIComponent(name)}`);
  } catch (e) { return; }
  if (!res || res.ok === false) return;
  const out = res.output || "";
  const entry = shell.terms[name];
  if (!entry) return;
  if (!force && out === entry.lastOutput) return;  // 변화 없으면 스킵
  entry.lastOutput = out;
  renderTerminalOutput(name, out);
}

function renderTerminalOutput(name, out) {
  const entry = shell.terms[name];
  if (!entry) return;
  if (entry.usingXterm && entry.term) {
    // capture-pane 는 전체 화면 스냅샷 — clear 후 재기록 (alt-screen 한계 동일 적용).
    entry.term.clear();
    entry.term.write(out.replace(/\n/g, "\r\n"));
  } else {
    const pre = document.getElementById("term-pre");
    if (pre) {
      pre.textContent = stripAnsi(out);
      pre.scrollTop = pre.scrollHeight;
    }
  }
}

// fallback 렌더용 최소 ANSI 제거 (색은 버리고 텍스트만)
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/* ──────────────────────────────────────────────────────────────────────────
   우측 탭 (Remote Desktop / Editor)
─────────────────────────────────────────────────────────────────────────── */

function renderRightTab(which) {
  const dPanel = document.getElementById("rpanel-desktop");
  const ePanel = document.getElementById("rpanel-editor");
  if (!dPanel || !ePanel) return;

  dPanel.classList.toggle("active", which === "desktop");
  ePanel.classList.toggle("active", which === "editor");

  if (which === "desktop") {
    if (shell.editorTimer) { clearInterval(shell.editorTimer); shell.editorTimer = null; }
    renderDesktopPanel();
  } else {
    renderEditorPanel();
  }
}

// ── M5: Remote Desktop ──
function renderDesktopPanel() {
  const host = (lastStatus && lastStatus.host) || "";
  const panel = document.getElementById("rpanel-desktop");
  panel.innerHTML = `
    <div class="rd-wrap">
      <div class="rd-card">
        <h3>🖥 호스트 화면 공유</h3>
        <p class="muted-note">
          ${host
            ? `호스트 <code>${esc(host)}</code> 의 화면을 macOS 화면 공유로 엽니다.`
            : `호스트가 설정되지 않았습니다. 🧭 마법사에서 host 를 먼저 지정하세요.`}
        </p>
        <button class="btn btn-primary" id="btn-desktop-open" ${host ? "" : "disabled"}>
          macOS 화면 공유 열기 (vnc://${esc(host || "호스트")})
        </button>
        <div class="rd-note" id="rd-note"></div>
      </div>
      <div class="rd-placeholder">
        <div class="ph-icon">🪟</div>
        <p>브라우저 내장 원격 데스크톱(noVNC / WebRTC)은 향후 업그레이드 예정입니다.</p>
        <p class="muted-note">현재 v0 는 macOS 화면 공유 앱을 arm's-length 로 실행만 합니다 (AGPL 코드 미포함).</p>
      </div>
    </div>`;

  document.getElementById("btn-desktop-open")?.addEventListener("click", async () => {
    const note = document.getElementById("rd-note");
    if (note) note.textContent = "여는 중...";
    try {
      const r = await apiPost("/api/desktop/open", {});
      if (note) note.textContent = r.ok ? `열림 (${r.via || "open"})` : `실패: ${r.error || ""}`;
    } catch (e) {
      if (note) note.textContent = `실패: ${e.message}`;
    }
  });
}

// ── M4: Editor (code-server iframe) ──
async function renderEditorPanel() {
  const panel = document.getElementById("rpanel-editor");
  panel.innerHTML = `<div class="ed-loading">에디터 상태 확인 중...</div>`;

  async function check() {
    let st;
    try { st = await apiGet("/api/editor/status"); }
    catch (e) { st = { running: false }; }
    if (st.running) {
      // 이미 iframe 이 떠 있으면 재생성하지 않음 (포커스/스크롤 보존)
      if (!panel.querySelector("iframe.ed-frame")) {
        panel.innerHTML = `<iframe class="ed-frame" src="${esc(st.url)}" title="code-server"></iframe>`;
      }
      if (shell.editorTimer) { clearInterval(shell.editorTimer); shell.editorTimer = null; }
    } else {
      panel.innerHTML = `
        <div class="ed-start">
          <div class="ph-icon">📝</div>
          <h3>에디터가 실행되고 있지 않습니다</h3>
          <p class="muted-note">code-server 를 <code>${esc(st.url || "127.0.0.1:8080")}</code> 에서 시작합니다.</p>
          <button class="btn btn-primary" id="btn-editor-start">에디터 시작</button>
          <div class="ed-note" id="ed-note"></div>
        </div>`;
      document.getElementById("btn-editor-start")?.addEventListener("click", async () => {
        const note = document.getElementById("ed-note");
        if (note) note.textContent = "시작 중...";
        try {
          const r = await apiPost("/api/editor/start", {});
          if (r.ok) {
            if (note) note.textContent = "시작 요청됨 — 떠오르면 자동으로 임베드됩니다.";
            if (!shell.editorTimer) shell.editorTimer = setInterval(check, 2000);
          } else {
            if (note) note.innerHTML = `시작 실패: ${esc(r.error || "")}<br><small class="muted-note">${esc(r.hint || "")}</small>`;
          }
        } catch (e) {
          if (note) note.textContent = `실패: ${e.message}`;
        }
      });
    }
  }
  check();
}

/* ──────────────────────────────────────────────────────────────────────────
   M2 — 알림 패널
─────────────────────────────────────────────────────────────────────────── */

const NOTIF_BADGE = {
  Stop:         { icon: "■", cls: "n-stop",   label: "Stop" },
  Notification: { icon: "🔔", cls: "n-notif",  label: "Notification" },
  SubagentStop: { icon: "◆", cls: "n-sub",    label: "SubagentStop" },
  approve:      { icon: "✋", cls: "n-approve",label: "approve" },
};

async function pollNotifications() {
  let res;
  try { res = await apiGet("/api/notifications"); }
  catch (e) { return; }
  if (!res || res.ok === false) return;
  const evs = res.events || [];
  if (evs.length) {
    shell.notifEvents = shell.notifEvents.concat(evs).slice(-200);
    shell.unseen += evs.length;
    updateNotifDot();
    // 드로어가 열려있으면 즉시 갱신
    if (!document.getElementById("notif-drawer").hidden) renderNotifList();
  }
}

function updateNotifDot() {
  const dot = document.getElementById("notif-dot");
  if (!dot) return;
  dot.hidden = shell.unseen <= 0;
}

function renderNotifList() {
  const list = document.getElementById("notif-list");
  if (!list) return;
  if (shell.notifEvents.length === 0) {
    list.innerHTML = `<p class="muted-note">새 알림이 없습니다.</p>`;
    return;
  }
  // 최신이 위로
  const items = shell.notifEvents.slice().reverse().map(ev => {
    const meta = NOTIF_BADGE[ev.type] || { icon: "•", cls: "n-other", label: ev.type || "?" };
    const when = ev.ts ? new Date(ev.ts * 1000).toLocaleTimeString() : "";
    const approveTag = ev.approvalType ? `<span class="n-tag">${esc(ev.approvalType)}</span>` : "";
    return `
      <div class="notif-item">
        <span class="n-badge ${meta.cls}">${meta.icon} ${esc(meta.label)}</span>
        ${approveTag}
        <div class="n-body">
          <div class="n-title">${esc(ev.title || "(제목 없음)")}</div>
          ${ev.message ? `<div class="n-msg">${esc(ev.message)}</div>` : ""}
          <div class="n-foot">${esc(ev.session || "")} ${when ? "· " + esc(when) : ""}</div>
        </div>
      </div>`;
  }).join("");
  list.innerHTML = items;
}

async function markNotificationsSeen() {
  try { await apiPost("/api/notifications/seen", {}); } catch (e) { /* ignore */ }
  shell.unseen = 0;
  updateNotifDot();
}

function openNotifDrawer() {
  closeDrawers();
  document.getElementById("notif-drawer").hidden = false;
  document.getElementById("drawer-backdrop").hidden = false;
  renderNotifList();
  // 열면 미확인 카운트는 0 으로 (커서 전진은 명시적 '모두 읽음' 으로)
  shell.unseen = 0;
  updateNotifDot();
}

/* ──────────────────────────────────────────────────────────────────────────
   설정 패널 — notify.conf ENABLED_TYPES
─────────────────────────────────────────────────────────────────────────── */

async function openSettingsDrawer() {
  closeDrawers();
  document.getElementById("settings-drawer").hidden = false;
  document.getElementById("drawer-backdrop").hidden = false;
  await renderSettings();
}

async function renderSettings() {
  const body = document.getElementById("settings-body");
  if (!body) return;
  body.innerHTML = `<p class="muted-note">불러오는 중...</p>`;
  let cfg;
  try { cfg = await apiGet("/api/notify/settings"); }
  catch (e) { body.innerHTML = `<p class="muted-note">설정 로드 실패: ${esc(e.message)}</p>`; return; }

  const all = cfg.allTypes || ["Stop", "Notification", "SubagentStop", "approve"];
  const enabled = new Set(cfg.enabledTypes || all);

  body.innerHTML = `
    <div class="set-group">
      <h4>알림 표시 종류</h4>
      <p class="muted-note">선택한 종류만 알림 패널에 표시됩니다 (host 와 client 양쪽이 이 설정을 읽습니다).</p>
      <div class="set-checks">
        ${all.map(t => `
          <label class="set-check">
            <input type="checkbox" data-ntype="${esc(t)}" ${enabled.has(t) ? "checked" : ""}>
            <span>${esc(t)}</span>
          </label>`).join("")}
      </div>
      <div class="set-actions">
        <button class="btn btn-primary btn-sm" id="set-save">저장</button>
        <span class="set-status" id="set-status"></span>
      </div>
    </div>`;

  document.getElementById("set-save")?.addEventListener("click", async () => {
    const checked = Array.from(body.querySelectorAll('input[data-ntype]:checked'))
      .map(i => i.dataset.ntype);
    const status = document.getElementById("set-status");
    if (status) status.textContent = "저장 중...";
    try {
      const r = await apiPost("/api/notify/settings", { enabledTypes: checked });
      if (status) status.textContent = r.ok ? "저장됨 ✓" : `실패: ${r.error || ""}`;
    } catch (e) {
      if (status) status.textContent = `실패: ${e.message}`;
    }
  });
}

// ── 드로어 공통 ───────────────────────────────────────────────────────────────
function closeDrawers() {
  const nd = document.getElementById("notif-drawer");
  const sd = document.getElementById("settings-drawer");
  const bd = document.getElementById("drawer-backdrop");
  if (nd) nd.hidden = true;
  if (sd) sd.hidden = true;
  if (bd) bd.hidden = true;
}

/* ──────────────────────────────────────────────────────────────────────────
   좌우 split 드래그
─────────────────────────────────────────────────────────────────────────── */
function initSplit() {
  const handle = document.getElementById("split-handle");
  const left   = document.getElementById("pane-left");
  if (!handle || !left) return;
  let dragging = false;
  handle.addEventListener("mousedown", () => { dragging = true; document.body.style.userSelect = "none"; });
  window.addEventListener("mouseup", () => { dragging = false; document.body.style.userSelect = ""; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const body = document.querySelector(".shell-body");
    if (!body) return;
    const rect = body.getBoundingClientRect();
    let pct = ((e.clientX - rect.left) / rect.width) * 100;
    pct = Math.max(25, Math.min(75, pct));
    left.style.flex = `0 0 ${pct}%`;
  });
}
