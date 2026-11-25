// app.js — Nối UI với lõi pic16.js (DOM + vòng lặp chạy + board + panel giám sát).
import { assemble, createCPU, parseIntelHex, exportHex, disassemble } from './pic16.js?v=20261125b';
import { EXAMPLES } from './examples.js?v=20261125a';
import {
  defaultNetlist, resolvePeripherals, checkWiring, ledStates,
  applyButtonToCpu, applyPotToCpu, createComponent, nextComponentId,
  PIC_PINS, PIN_BY_ID, COMPONENT_DEFS,
} from './wiring.js?v=20261125b';

const $ = (id) => document.getElementById(id);
const editor = $('editor'), gutter = $('gutter'), errorsBox = $('errors');

const cpu = createCPU();
cpu.clockHz = 4000000;
let asmResult = null;          // kết quả assemble gần nhất
let running = false, timerId = null;
let speed = '1';               // '0.1' | '0.5' | '1' | 'max'
let breakpoints = new Set();   // địa chỉ program có breakpoint
let currentExampleId = 'blink';
let labIdx = 0;

// --- Đấu nối breadboard (netlist là nguồn sự thật) ---
const LS_WIRING_KEY = 'hoatrang-wiring-v1';
function loadStoredWiring() {
  try {
    const raw = localStorage.getItem(LS_WIRING_KEY);
    if (!raw) return defaultNetlist();
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.components) || !Array.isArray(data.wires)) return defaultNetlist();
    return data;
  } catch { return defaultNetlist(); }
}
function saveWiring() {
  try { localStorage.setItem(LS_WIRING_KEY, JSON.stringify(netlist)); } catch { /* bộ nhớ đầy/khóa: bỏ qua */ }
}
let netlist = loadStoredWiring();
let mapping = resolvePeripherals(netlist);
cpu.setWiring(mapping);
let potVoltsById = {};         // id chiết áp -> volt (0..5)
let buzzerSound = false;       // tiếng còi bật/tắt (mặc định tắt)
let audioCtx = null, buzzerOsc = null, buzzerGain = null;

// Trạng thái breadboard (khai báo sớm: applyWiring() chạy ngay ở khởi động)
const bbSvg = $('bbSvg');
let selectedWireId = null, selectedCompId = null, pendingTerm = null;
let highlight = null; // { wireIds, compIds, terminalIds } từ panel Kiểm tra
let dragTerm = null, dragMoved = false, dragStartXY = null, downTarget = null, dragCurrent = null;
let wireSeq = 1000;

// --- Định dạng ---
const hex = (v, n = 2) => '0x' + (v & ((1 << (n * 4)) - 1)).toString(16).toUpperCase().padStart(n, '0');
function fmtTime(us) {
  if (us < 1000) return `${us.toFixed(0)} µs`;
  if (us < 1e6) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1e6).toFixed(3)} s`;
}
function fmtFreq(hz) {
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${hz.toFixed(2)} Hz`;
}

// --- Trạng thái ---
function setStatus(text, kind = '') {
  $('statusText').textContent = text;
  $('statusbar').className = 'statusbar' + (kind ? ' ' + kind : '');
  $('btnRun').disabled = running;
  $('btnPause').disabled = !running;
}
function refreshStatus() {
  $('statPc').textContent = hex(cpu.pc & 0x1fff, 3);
  $('statCycles').textContent = cpu.cycles.toLocaleString('vi-VN');
  $('statTime').textContent = fmtTime(cpu.simTimeUs);
}

// --- Editor + gutter ---
function lineCount() { return editor.value.split('\n').length; }
function updateGutter() {
  const curLine = asmResult?.addrToLine.get(cpu.pc & 0x1fff);
  let html = '';
  for (let i = 1; i <= lineCount(); i++) {
    const addr = asmResult?.lineToAddr.get(i);
    const cls = [
      addr !== undefined && breakpoints.has(addr) ? 'bp' : '',
      curLine === i ? 'current' : '',
    ].join(' ');
    html += `<span class="${cls}" data-line="${i}">${i}</span>`;
  }
  gutter.innerHTML = html;
}
gutter.addEventListener('click', (e) => {
  const span = e.target.closest('span[data-line]');
  if (!span) return;
  const line = Number(span.dataset.line);
  const addr = asmResult?.lineToAddr.get(line);
  if (addr === undefined) return; // dòng không có lệnh: không đặt được breakpoint
  if (breakpoints.has(addr)) breakpoints.delete(addr); else breakpoints.add(addr);
  updateGutter();
});
editor.addEventListener('input', updateGutter);
editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); assembleAndLoad(); }
});

// --- Dịch & nạp ---
function assembleAndLoad() {
  stopRun();
  const r = assemble(editor.value);
  asmResult = r;
  if (r.errors.length) {
    errorsBox.innerHTML = r.errors.map((e) =>
      `<button type="button" class="err" data-line="${e.line}">Dòng ${e.line}: ${e.message} — bấm để nhảy tới</button>`).join('');
    setStatus(`Lỗi dịch: ${r.errors.length} lỗi`, 'error');
  } else {
    errorsBox.innerHTML = `<p class="ok-msg">Đã dịch xong: ${r.listing.length} lệnh, 0 lỗi — đã nạp vào CPU.</p>`;
    cpu.loadProgram(r.program);
    applyAllPots();
    setStatus('Đã nạp — sẵn sàng chạy');
  }
  breakpoints = new Set([...breakpoints].filter((a) => a < 8192));
  renderListing();
  updateGutter();
  refreshAll();
}
errorsBox.addEventListener('click', (e) => {
  const btn = e.target.closest('.err[data-line]');
  if (!btn) return;
  jumpToEditorLine(Number(btn.dataset.line));
});
function jumpToEditorLine(line) {
  const lines = editor.value.split('\n');
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  editor.focus();
  editor.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  editor.scrollTop = Math.max(0, (line - 8) * 20);
}

// --- Vòng lặp chạy ---
function stepOnce() {
  const before = cpu.cycles;
  cpu.step();
  return cpu.cycles - before;
}
function runTick() {
  if (!running) return;
  const ips = (cpu.clockHz / 4) * (speed === 'max' ? 0 : parseFloat(speed));
  let budget = speed === 'max' ? 200000 : Math.max(1, Math.round(ips * 0.05));
  while (budget > 0 && running) {
    budget -= stepOnce();
    if (cpu.sleeping) { stopRun('CPU đang SLEEP — chờ ngắt'); break; }
    if (breakpoints.has(cpu.pc & 0x1fff)) { stopRun('Dừng tại breakpoint'); break; }
  }
  sampleLogic();
  refreshAll();
}
function startRun() {
  if (running) return;
  if (!asmResult || asmResult.errors.length) { assembleAndLoad(); if (asmResult.errors.length) return; }
  running = true;
  setStatus('Đang chạy', 'running');
  timerId = setInterval(runTick, 50);
}
function stopRun(reason) {
  if (timerId) { clearInterval(timerId); timerId = null; }
  const wasRunning = running;
  running = false;
  if (reason) setStatus(reason);
  else if (wasRunning) setStatus('Tạm dừng');
  $('btnRun').disabled = false;
  $('btnPause').disabled = true;
}
$('btnAssemble').addEventListener('click', assembleAndLoad);
$('btnRun').addEventListener('click', startRun);
$('btnPause').addEventListener('click', () => stopRun());
$('btnStep').addEventListener('click', () => {
  stopRun();
  stepOnce();
  sampleLogic();
  refreshAll();
  setStatus('Chạy từng lệnh — PC ' + hex(cpu.pc & 0x1fff, 3));
});
$('btnReset').addEventListener('click', () => {
  stopRun();
  cpu.reset();
  applyAllPots();
  $('uartOut').innerHTML = '';
  logicSamples = [];
  setStatus('Đã reset — sẵn sàng chạy');
  refreshAll();
});
document.querySelectorAll('.seg [data-speed]').forEach((b) => {
  b.addEventListener('click', () => {
    speed = b.dataset.speed;
    document.querySelectorAll('.seg [data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
});
$('clockSel').addEventListener('change', (e) => { cpu.clockHz = Number(e.target.value); refreshStatus(); });

// --- Ví dụ mẫu + Bài học (lab) ---
const exampleSel = $('exampleSel');
exampleSel.innerHTML = EXAMPLES.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
exampleSel.value = currentExampleId;
function loadExample(id) {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) return;
  currentExampleId = id;
  labIdx = 0;
  editor.value = ex.code;
  $('labTitle').textContent = `Bài học: ${ex.name}`;
  renderLab();
  assembleAndLoad();
}
exampleSel.addEventListener('change', (e) => loadExample(e.target.value));
function renderLab() {
  const ex = EXAMPLES.find((e) => e.id === currentExampleId);
  if (!ex) return;
  $('labStepCount').textContent = `Bước ${labIdx + 1}/${ex.lab.length}: ${ex.lab[labIdx].t}`;
  $('labStepText').textContent = ex.lab[labIdx].d;
  $('labSteps').innerHTML = ex.lab.map((s, i) =>
    `<li class="${i === labIdx ? 'active' : ''}">${s.t}</li>`).join('');
  $('labPrev').disabled = labIdx === 0;
  $('labNext').disabled = labIdx === ex.lab.length - 1;
}
$('labPrev').addEventListener('click', () => { labIdx = Math.max(0, labIdx - 1); renderLab(); });
$('labNext').addEventListener('click', () => {
  const ex = EXAMPLES.find((e) => e.id === currentExampleId);
  labIdx = Math.min(ex.lab.length - 1, labIdx + 1); renderLab();
});

// --- Board: LED, nút nhấn, chiết áp, LCD, còi — vẽ lại từ mapping (netlist) ---
// Áp điện áp của mọi chiết áp vào đúng kênh AN đã nối dây
function applyAllPots() {
  for (const p of mapping.pots) applyPotToCpu(cpu, mapping, p.id, potVoltsById[p.id] ?? 0);
}
function refreshPotReadouts() {
  for (const p of mapping.pots) {
    const el = $('potVal-' + p.id);
    if (!el) continue;
    const v = potVoltsById[p.id] ?? 0;
    el.textContent = p.wiper
      ? `${v.toFixed(2)} V · ADC ≈ ${Math.round((v / 5) * 1023)}`
      : `${v.toFixed(2)} V · wiper chưa nối chân AN`;
  }
}
function renderBoard() {
  // LED (kể cả LED thêm từ khay)
  $('leds').innerHTML = mapping.leds.map((led) =>
    `<div class="led-cell"><div class="led" id="led-${led.id}" aria-label="${led.label}"></div><span>${led.label}${led.pin ? '' : ' · chưa nối'}</span></div>`).join('');
  // Nút nhấn
  const pushBox = $('pushBtns');
  pushBox.innerHTML = mapping.buttons.map((b) =>
    `<button type="button" class="push-btn" data-btn="${b.id}" aria-label="Nút nhấn ${b.label}">${b.label}${b.pin ? '' : ' · chưa nối'}</button>`).join('');
  pushBox.querySelectorAll('.push-btn').forEach((btn) => {
    const id = btn.dataset.btn;
    const press = (e) => { e.preventDefault(); btn.classList.add('pressed'); applyButtonToCpu(cpu, mapping, id, true); refreshAll(); };
    const release = () => { btn.classList.remove('pressed'); applyButtonToCpu(cpu, mapping, id, false); refreshAll(); };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); press(e); } });
    btn.addEventListener('keyup', release);
  });
  // Chiết áp (mỗi cái một thanh trượt riêng)
  $('pots').innerHTML = mapping.pots.map((p) =>
    `<div class="pot-block"><p class="board-label">${p.label}${p.wiper ? ' — ' + p.wiper.id + ' (AN' + p.wiper.analog + ')' : ' — wiper chưa nối'}</p>` +
    `<input type="range" class="pot-slider" data-pot="${p.id}" min="0" max="5" step="0.05" value="${potVoltsById[p.id] ?? 0}" aria-label="Chiết áp ${p.label}, 0 đến 5 volt">` +
    `<p class="pot-read" id="potVal-${p.id}"></p></div>`).join('');
  document.querySelectorAll('.pot-slider').forEach((s) => s.addEventListener('input', (e) => {
    potVoltsById[s.dataset.pot] = Number(e.target.value);
    applyPotToCpu(cpu, mapping, s.dataset.pot, Number(e.target.value));
    refreshPotReadouts();
  }));
  // Còi buzzer
  const bz = $('buzzerRow');
  if (!mapping.buzzers.length) {
    bz.innerHTML = '<span class="sub">Chưa có còi buzzer — thêm từ tab Đấu nối.</span>';
  } else {
    bz.innerHTML = mapping.buzzers.map((b) =>
      `<span class="buzzer" id="buzzer-${b.id}">${b.label}${b.pin ? ' · ' + b.pin.id : ' · chưa nối'}</span>`).join(' ') +
      ` <button class="btn btn-small" id="btnBuzzerSound" type="button" aria-pressed="${buzzerSound}">${buzzerSound ? 'Tắt tiếng còi' : 'Bật tiếng còi'}</button>`;
    $('btnBuzzerSound').addEventListener('click', () => {
      buzzerSound = !buzzerSound;
      if (buzzerSound) ensureAudio();
      renderBoard();
      refreshAll();
    });
  }
  refreshPotReadouts();
}
// WebAudio cho còi: chỉ tạo sau thao tác của user (trình duyệt chặn autoplay)
function ensureAudio() {
  if (!audioCtx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      buzzerOsc = audioCtx.createOscillator();
      buzzerOsc.type = 'square';
      buzzerOsc.frequency.value = 1200;
      buzzerGain = audioCtx.createGain();
      buzzerGain.gain.value = 0;
      buzzerOsc.connect(buzzerGain).connect(audioCtx.destination);
      buzzerOsc.start();
    } catch { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function updateBuzzerAudio() {
  const anyOn = mapping.buzzers.some((b) => {
    if (!b.pin) return false;
    return cpu.pinDirection(b.pin.port, b.pin.bit) === 'out' && cpu.pinLevel(b.pin.port, b.pin.bit) === 1;
  });
  for (const b of mapping.buzzers) {
    const el = $('buzzer-' + b.id);
    if (el) el.classList.toggle('on', !!b.pin && cpu.pinDirection(b.pin.port, b.pin.bit) === 'out' && cpu.pinLevel(b.pin.port, b.pin.bit) === 1);
  }
  if (buzzerGain) buzzerGain.gain.value = (anyOn && buzzerSound) ? 0.04 : 0;
}
cpu.onTx = (code) => {
  const out = $('uartOut');
  out.appendChild(document.createTextNode(String.fromCharCode(code)));
  if (out.textContent.length > 4000) out.textContent = out.textContent.slice(-4000);
  out.scrollTop = out.scrollHeight;
};
function sendUart() {
  const inp = $('uartIn');
  const text = inp.value;
  if (!text) return;
  for (const ch of text) cpu.receiveChar(ch.charCodeAt(0));
  const out = $('uartOut');
  const s = document.createElement('span');
  s.className = 'sent';
  s.textContent = `» ${text}\n`;
  out.appendChild(s);
  out.scrollTop = out.scrollHeight;
  inp.value = '';
  inp.focus();
}
$('uartSend').addEventListener('click', sendUart);
$('uartIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendUart(); });

// --- Nạp file .hex / tải xuống .asm / .hex ---
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('btnLoadHex').addEventListener('click', () => $('hexFile').click());
$('hexFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const r = parseIntelHex(text);
  if (r.errors.length) {
    errorsBox.innerHTML = r.errors.map((er) => `<button type="button" class="err">HEX: ${er.message}</button>`).join('');
    setStatus('File .hex lỗi', 'error');
    return;
  }
  stopRun();
  cpu.loadProgram(r.program, r.config);
  applyAllPots();
  // Listing tổng hợp từ disassembly (không có nguồn ASM)
  const listing = [];
  let last = 0;
  for (let i = 8191; i >= 0; i--) { if (r.program[i] !== 0) { last = i; break; } }
  for (let a = 0; a <= last; a++) listing.push({ addr: a, code: r.program[a], text: disassemble(r.program[a], a), line: 0 });
  asmResult = { program: r.program, errors: [], listing, lineToAddr: new Map(), addrToLine: new Map() };
  errorsBox.innerHTML = `<p class="ok-msg">Đã nạp file .hex: ${r.words} word, config ${hex(r.config, 4)}.</p>`;
  setStatus('Đã nạp file .hex — sẵn sàng chạy');
  renderListing();
  refreshAll();
  e.target.value = '';
});
$('btnDownloadAsm').addEventListener('click', () => download('pic16f877a.asm', editor.value));
$('btnDownloadHex').addEventListener('click', () => download('pic16f877a.hex', exportHex(cpu.program, cpu.config)));

// --- Listing ---
function renderListing() {
  const body = $('listingBody');
  if (!asmResult) { body.innerHTML = ''; return; }
  body.innerHTML = asmResult.listing.map((l) =>
    `<tr data-addr="${l.addr}"><td class="addr">${hex(l.addr, 3)}</td><td class="op">${hex(l.code, 4)}</td><td>${l.text}</td><td>${l.line ? 'dòng ' + l.line : ''}</td></tr>`).join('');
  highlightListingRow();
}
function highlightListingRow() {
  document.querySelectorAll('#listingBody tr').forEach((tr) => {
    tr.classList.toggle('current', Number(tr.dataset.addr) === (cpu.pc & 0x1fff));
  });
  const cur = document.querySelector('#listingBody tr.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
$('listingBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-addr]');
  if (!tr) return;
  const line = asmResult?.addrToLine.get(Number(tr.dataset.addr));
  if (line) jumpToEditorLine(line);
});

// --- Thanh ghi / RAM / GPIO ---
const REG_DEFS = [
  ['W', () => cpu.w], ['STATUS', () => cpu.sfr.STATUS], ['PCL', () => cpu.pc & 0xff],
  ['PCLATH', () => cpu.sfr.PCLATH], ['FSR', () => cpu.sfr.FSR],
  ['TMR0', () => cpu.sfr.TMR0], ['TMR1', () => (cpu.sfr.TMR1H << 8) | cpu.sfr.TMR1L],
  ['TMR2', () => cpu.sfr.TMR2], ['INTCON', () => cpu.sfr.INTCON],
  ['PORTA', () => cpu.readPort(0)], ['PORTB', () => cpu.readPort(1)],
  ['PORTC', () => cpu.readPort(2)], ['PORTD', () => cpu.readPort(3)], ['PORTE', () => cpu.readPort(4)],
  ['TRISA', () => cpu.tris[0]], ['TRISB', () => cpu.tris[1]], ['TRISC', () => cpu.tris[2]],
  ['TRISD', () => cpu.tris[3]], ['TRISE', () => cpu.tris[4]],
  ['ADCON0', () => cpu.sfr.ADCON0], ['ADCON1', () => cpu.sfr.ADCON1],
  ['ADRESH', () => cpu.sfr.ADRESH], ['ADRESL', () => cpu.sfr.ADRESL],
  ['TXSTA', () => cpu.sfr.TXSTA], ['RCSTA', () => cpu.sfr.RCSTA],
  ['SPBRG', () => cpu.sfr.SPBRG], ['PIR1', () => cpu.readSFR('PIR1')], ['PIE1', () => cpu.sfr.PIE1],
];
$('regGrid').innerHTML = REG_DEFS.map(([k], i) => `<div class="reg"><div class="k">${k}</div><div class="v" id="reg${i}">0x00</div></div>`).join('');
function renderFlags(el, value, names) {
  el.innerHTML = names.map(([bit, name]) =>
    `<span class="flag ${((value >> bit) & 1) ? 'on' : ''}">${name}</span>`).join('');
}
const RAM_ADDRS = [];
for (let a = 0x20; a <= 0x7f; a++) RAM_ADDRS.push(a);
$('ramTable').innerHTML = '<tr><th></th>' + Array.from({ length: 16 }, (_, i) => `<th>+${i.toString(16).toUpperCase()}</th>`).join('') + '</tr>'
  + [0x20, 0x30, 0x40, 0x50, 0x60, 0x70].map((base) =>
    `<tr><th>${hex(base)}</th>` + Array.from({ length: 16 }, (_, i) =>
      `<td id="ram${base + i}">00</td>`).join('') + '</tr>').join('');
const GPIO_PINS = [];
for (let p = 0; p < 5; p++) for (let b = 0; b < [6, 8, 8, 8, 3][p]; b++) GPIO_PINS.push([p, b]);
$('gpioGrid').innerHTML = GPIO_PINS.map(([p, b]) => {
  const name = 'R' + 'ABCDE'[p] + b;
  return `<div class="gpio-row"><span>${name}</span><span class="dir" id="gpioDir${p}${b}">—</span><span class="val" id="gpioVal${p}${b}">Z</span><span class="lvl" id="gpioLvl${p}${b}">mức 0</span></div>`;
}).join('');

// --- Logic Analyzer ---
const LA_COLORS = ['#1E3A5F', '#2563EB', '#059669', '#DC2626'];
const LA_PIN_NAMES = [];
for (let b = 0; b < 6; b++) LA_PIN_NAMES.push(['RA' + b, 0, b]);
for (let b = 0; b < 8; b++) LA_PIN_NAMES.push(['RB' + b, 1, b]);
for (let b = 0; b < 8; b++) LA_PIN_NAMES.push(['RC' + b, 2, b]);
for (let b = 0; b < 8; b++) LA_PIN_NAMES.push(['RD' + b, 3, b]);
for (let b = 0; b < 3; b++) LA_PIN_NAMES.push(['RE' + b, 4, b]);
let laPins = [[1, 0], [1, 1], [2, 0], [2, 6]]; // mặc định RB0, RB1, RC0, RC6/TX
let logicSamples = []; // {t: µs, v: [0/1 x4]}
document.querySelectorAll('.la-pin').forEach((sel, idx) => {
  sel.innerHTML = LA_PIN_NAMES.map(([n, p, b]) => `<option value="${p},${b}">${n}${p === 2 && b === 6 ? ' /TX' : ''}</option>`).join('');
  sel.value = `${laPins[idx][0]},${laPins[idx][1]}`;
  sel.addEventListener('change', () => {
    const [p, b] = sel.value.split(',').map(Number);
    laPins[idx] = [p, b];
    drawLogic();
  });
});
function sampleLogic() {
  logicSamples.push({ t: cpu.simTimeUs, v: laPins.map(([p, b]) => cpu.pinLevel(p, b)) });
  if (logicSamples.length > 800) logicSamples.splice(0, logicSamples.length - 800);
}
function drawLogic() {
  const canvas = $('logicCanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 800, h = 180;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const n = logicSamples.length;
  const laneH = h / 4;
  // Lưới nền
  ctx.strokeStyle = '#E4E7EB'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * laneH); ctx.lineTo(w, i * laneH); ctx.stroke(); }
  if (n < 2) {
    ctx.fillStyle = '#475569'; ctx.font = '13px "Fira Sans", sans-serif';
    ctx.fillText('Chưa có dữ liệu — bấm Chạy tất cả để ghi sóng.', 12, h / 2);
    return;
  }
  const view = logicSamples.slice(-400); // cửa sổ 400 mẫu gần nhất, cuộn được
  const x = (i) => (i / Math.max(1, view.length - 1)) * (w - 70) + 60;
  for (let ch = 0; ch < 4; ch++) {
    const [p, b] = laPins[ch];
    const name = LA_PIN_NAMES.find(([, pp, bb]) => pp === p && bb === b)[0];
    const top = ch * laneH, mid = top + laneH / 2, amp = laneH * 0.32;
    ctx.fillStyle = LA_COLORS[ch]; ctx.font = '600 12px "Fira Code", monospace';
    ctx.fillText(name, 6, mid + 4);
    ctx.strokeStyle = LA_COLORS[ch]; ctx.lineWidth = 2; ctx.beginPath();
    view.forEach((s, i) => {
      const y = mid - (s.v[ch] ? amp : -amp);
      if (i === 0) ctx.moveTo(x(i), y); else { ctx.lineTo(x(i - 1), y); ctx.lineTo(x(i), y); }
    });
    ctx.stroke();
  }
  // Tần số / duty của kênh 1 (theo toàn bộ mẫu đang giữ)
  const s0 = logicSamples;
  let edges = 0, high = 0;
  for (let i = 1; i < s0.length; i++) { if (s0[i].v[0] === 1 && s0[i - 1].v[0] === 0) edges++; if (s0[i].v[0] === 1) high++; }
  const span = s0[s0.length - 1].t - s0[0].t;
  const [p0, b0] = laPins[0];
  const name0 = LA_PIN_NAMES.find(([, pp, bb]) => pp === p0 && bb === b0)[0];
  $('laInfo').textContent = span > 0 && edges >= 1
    ? `${name0}: tần số ≈ ${fmtFreq((edges / span) * 1e6)} · duty ≈ ${Math.round((high / s0.length) * 100)}% · mức hiện tại ${s0[s0.length - 1].v[0]} · ${s0.length} mẫu`
    : `${name0}: chưa đủ cạnh lên để ước lượng tần số · mức hiện tại ${s0[s0.length - 1].v[0]} · ${s0.length} mẫu`;
}
$('laClear').addEventListener('click', () => { logicSamples = []; drawLogic(); $('laInfo').textContent = 'Đã xoá sóng.'; });
window.addEventListener('resize', drawLogic);

// --- Refresh toàn bộ UI ---
function refreshAll() {
  refreshStatus();
  updateGutter();
  highlightListingRow();
  // LED — trạng thái theo đúng dây đã nối (ledStates đọc từ netlist)
  for (const s of ledStates(cpu, mapping)) {
    const el = $('led-' + s.id);
    if (el) el.classList.toggle('on', s.on);
  }
  // LCD — nếu chưa nối đủ dây thì báo rõ, không hiện chữ cũ
  const lcdOk = !mapping.lcd.id || mapping.lcd.complete;
  const [l0, l1] = cpu.lcd.getLines();
  $('lcdLine0').textContent = lcdOk ? l0 : '                ';
  $('lcdLine1').textContent = lcdOk ? l1 : '                ';
  const lcdStatus = $('lcdStatus');
  if (!lcdOk) {
    lcdStatus.hidden = false;
    lcdStatus.textContent = `LCD chưa nối đủ dây — thiếu: ${mapping.lcd.missing.join(', ')}. Sang tab Đấu nối để nối thêm.`;
  } else {
    lcdStatus.hidden = true;
  }
  // Thanh ghi
  REG_DEFS.forEach(([, get], i) => { $('reg' + i).textContent = hex(get()); });
  renderFlags($('statusFlags'), cpu.sfr.STATUS, [[0, 'C'], [1, 'DC'], [2, 'Z'], [3, 'PD'], [4, 'TO'], [5, 'RP0'], [6, 'RP1'], [7, 'IRP']]);
  renderFlags($('intconFlags'), cpu.sfr.INTCON, [[7, 'GIE'], [6, 'PEIE'], [5, 'TMR0IE'], [4, 'INTE'], [3, 'RBIE'], [2, 'TMR0IF'], [1, 'INTF'], [0, 'RBIF']]);
  // RAM
  const ram = cpu.readRamBank0();
  ram.forEach((v, i) => { const td = $('ram' + (0x20 + i)); if (td) td.textContent = v.toString(16).toUpperCase().padStart(2, '0'); });
  // GPIO
  GPIO_PINS.forEach(([p, b]) => {
    const dir = cpu.pinDirection(p, b);
    const lvl = cpu.pinLevel(p, b);
    const dirEl = $('gpioDir' + p + b), valEl = $('gpioVal' + p + b), lvlEl = $('gpioLvl' + p + b);
    dirEl.textContent = dir === 'in' ? 'Vào' : 'Ra';
    dirEl.className = 'dir ' + (dir === 'in' ? 'dir-in' : 'dir-out');
    valEl.textContent = dir === 'in' ? 'Z' : String(lvl);
    valEl.className = 'val ' + (lvl === 1 ? 'val-1' : '');
    lvlEl.textContent = 'mức ' + lvl;
  });
  refreshPotReadouts();
  updateBuzzerAudio();
  updateBreadboardLive();
  drawLogic();
}

// --- Khởi động ---
$('labTitle').textContent = 'Bài học: Nhấp nháy LED RB0';
applyWiring(); // vẽ board + breadboard từ netlist đã lưu (hoặc mạch mẫu)
loadExample('blink');
refreshAll();

// ===========================================================================
// BREADBOARD KÉO DÂY (view "Đấu nối")
// Bố cục SVG 1000x780, nhìn từ trên: chip DIP-40 ở giữa, thanh +5V (trái),
// thanh GND (phải), linh kiện xung quanh. Dây vẽ bằng SVG path cong.
// Kéo-thả chuột hoặc bấm lần lượt 2 đầu nối (dùng được trên điện thoại).
// ===========================================================================
const BB_W = 1000, BB_H = 780;
const PIN_Y0 = 140, PIN_DY = 26;

// Vị trí đầu nối trong viewBox
function picPinPos(pinId) {
  const pin = PIN_BY_ID[pinId];
  if (!pin) return null;
  if (pin.num <= 20) return { x: 392, y: PIN_Y0 + (pin.num - 1) * PIN_DY };
  return { x: 608, y: PIN_Y0 + (40 - pin.num) * PIN_DY };
}
// Đầu nối của linh kiện (offset tương đối theo loại)
function compTermOffsets(kind) {
  if (kind === 'led') return { A: [6, 42], K: [26, 42] };
  if (kind === 'button') return { T1: [10, 52], T2: [54, 52] };
  if (kind === 'pot') return { VCC: [12, 68], W: [45, 68], GND: [78, 68] };
  if (kind === 'lcd') {
    const o = { RS: [24, -10], E: [56, -10] };
    for (let i = 0; i < 8; i++) o['D' + i] = [96 + i * 28, -10];
    return o;
  }
  if (kind === 'buzzer') return { P: [8, 48], N: [32, 48] };
  return {};
}
function termPos(term, yHint) {
  if (term === 'VCC' || term === 'GND') {
    const x = term === 'VCC' ? 40 : 960;
    const taps = [160, 300, 440, 580];
    let best = taps[0];
    if (yHint !== undefined) for (const t of taps) if (Math.abs(t - yHint) < Math.abs(best - yHint)) best = t;
    return { x, y: best };
  }
  if (term.startsWith('PIC.')) return picPinPos(term.slice(4));
  const dot = term.lastIndexOf('.');
  const comp = netlist.components.find((c) => c.id === term.slice(0, dot));
  if (!comp) return null;
  const off = compTermOffsets(comp.kind)[term.slice(dot + 1)];
  if (!off) return null;
  return { x: comp.x + off[0], y: comp.y + off[1] };
}
function wirePath(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const c = Math.max(40, Math.min(160, Math.abs(dx) * 0.5)) * Math.sign(dx || 1);
    return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
  }
  const c = Math.max(40, Math.min(160, Math.abs(dy) * 0.5)) * Math.sign(dy || 1);
  return `M ${x1} ${y1} C ${x1} ${y1 + c}, ${x2} ${y2 - c}, ${x2} ${y2}`;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderChip() {
  let s = `<g><rect x="404" y="120" width="192" height="534" rx="10" class="bb-chip"/>`;
  s += `<text x="500" y="380" text-anchor="middle" class="bb-chip-name">PIC16F877A</text>`;
  s += `<text x="500" y="400" text-anchor="middle" class="bb-chip-sub">DIP-40 · 8K x 14-bit</text>`;
  // Chân trái (1..20) và phải (21..40) — duyệt PIC_PINS để đủ cả 2 chân VDD/VSS
  const allPins = PIC_PINS;
  for (const pin of allPins) {
    const pos = picPinPos(pin.id);
    const left = pin.num <= 20;
    const stubX = left ? 396 : 596;
    s += `<rect x="${stubX}" y="${pos.y - 4}" width="12" height="8" class="bb-pin-stub"/>`;
    s += `<g class="bb-term${pendingTerm === 'PIC.' + pin.id ? ' pending' : ''}${highlight && highlight.terminalIds && highlight.terminalIds.includes('PIC.' + pin.id) ? ' hl' : ''}" data-term="PIC.${pin.id}">`;
    s += `<circle cx="${pos.x}" cy="${pos.y}" r="13" class="bb-term-hit"/><circle cx="${pos.x}" cy="${pos.y}" r="7" class="bb-term-dot"/>`;
    s += `<title>${pin.label} (chân ${pin.num})</title></g>`;
    s += `<text x="${left ? 388 : 612}" y="${pos.y + 4}" text-anchor="${left ? 'end' : 'start'}" class="bb-pin-label">${esc(pin.label)}</text>`;
  }
  // VDD/VSS/MCLR nối sẵn nguồn: vẽ đoạn ngắn + nhãn (không phải dây user đi)
  for (const [pinId, tag] of [['MCLR', '+5V'], ['VDD', '+5V'], ['VSS', 'GND']]) {
    const pin = PIN_BY_ID[pinId];
    if (!pin) continue;
    const pos = picPinPos(pinId);
    const left = pin.num <= 20;
    const tx = left ? pos.x - 22 : pos.x + 22;
    s += `<line x1="${pos.x}" y1="${pos.y}" x2="${tx}" y2="${pos.y}" class="bb-fixed-wire"/>`;
    s += `<text x="${tx}" y="${pos.y + 15}" text-anchor="middle" class="bb-fixed-label">${tag}</text>`;
  }
  return s + '</g>';
}

function renderRails() {
  let s = `<rect x="28" y="100" width="24" height="560" rx="6" class="bb-rail-vcc"/><text x="40" y="92" text-anchor="middle" class="bb-rail-label-vcc">+5V</text>`;
  s += `<rect x="948" y="100" width="24" height="560" rx="6" class="bb-rail-gnd"/><text x="960" y="92" text-anchor="middle" class="bb-rail-label-gnd">GND</text>`;
  for (const y of [160, 300, 440, 580]) {
    s += `<g class="bb-term${pendingTerm === 'VCC' ? ' pending' : ''}" data-term="VCC"><circle cx="40" cy="${y}" r="13" class="bb-term-hit"/><circle cx="40" cy="${y}" r="7" class="bb-term-dot bb-term-vcc"/><title>+5V</title></g>`;
    s += `<g class="bb-term${pendingTerm === 'GND' ? ' pending' : ''}" data-term="GND"><circle cx="960" cy="${y}" r="13" class="bb-term-hit"/><circle cx="960" cy="${y}" r="7" class="bb-term-dot bb-term-gnd"/><title>GND</title></g>`;
  }
  return s;
}

function renderComponent(comp) {
  const sel = selectedCompId === comp.id ? ' selected' : '';
  const hl = highlight && highlight.compIds && highlight.compIds.includes(comp.id) ? ' hl' : '';
  const terms = COMPONENT_DEFS[comp.kind].terms;
  const offs = compTermOffsets(comp.kind);
  let inner = '';
  const termSvg = (t) => {
    const [ox, oy] = offs[t];
    const id = comp.id + '.' + t;
    const label = COMPONENT_DEFS[comp.kind].termLabels[t];
    return `<g class="bb-term${pendingTerm === id ? ' pending' : ''}${highlight && highlight.terminalIds && highlight.terminalIds.includes(id) ? ' hl' : ''}" data-term="${id}">` +
      `<circle cx="${ox}" cy="${oy}" r="13" class="bb-term-hit"/><circle cx="${ox}" cy="${oy}" r="7" class="bb-term-dot"/><title>${esc(comp.label)} — ${esc(label)}</title></g>` +
      `<text x="${ox}" y="${oy - 12}" text-anchor="middle" class="bb-term-label">${esc(t)}</text>`;
  };
  if (comp.kind === 'led') {
    const on = ledStates(cpu, mapping).find((x) => x.id === comp.id)?.on;
    inner = `<circle id="bb-led-${comp.id}" cx="16" cy="14" r="11" class="bb-led-body${on ? ' on' : ''}"/>` +
      `<text x="16" y="58" text-anchor="middle" class="bb-comp-label">${esc(comp.label)}</text>` +
      terms.map(termSvg).join('');
  } else if (comp.kind === 'button') {
    inner = `<rect x="0" y="0" width="64" height="40" rx="6" class="bb-comp-body"/>` +
      `<circle cx="32" cy="20" r="10" class="bb-btn-knob"/>` +
      `<text x="32" y="66" text-anchor="middle" class="bb-comp-label">${esc(comp.label)}</text>` +
      terms.map(termSvg).join('');
  } else if (comp.kind === 'pot') {
    inner = `<rect x="0" y="0" width="90" height="56" rx="6" class="bb-comp-body"/>` +
      `<circle cx="45" cy="28" r="14" class="bb-pot-knob"/><line x1="45" y1="28" x2="45" y2="16" class="bb-pot-pointer"/>` +
      `<text x="45" y="82" text-anchor="middle" class="bb-comp-label">${esc(comp.label)}</text>` +
      terms.map(termSvg).join('');
  } else if (comp.kind === 'lcd') {
    inner = `<rect x="0" y="0" width="340" height="64" rx="6" class="bb-comp-body bb-lcd-body"/>` +
      `<text id="bb-lcd-${comp.id}-0" x="12" y="26" class="bb-lcd-text">                </text>` +
      `<text id="bb-lcd-${comp.id}-1" x="12" y="50" class="bb-lcd-text">                </text>` +
      `<text x="332" y="12" text-anchor="end" class="bb-comp-label">${esc(comp.label)}</text>` +
      terms.map(termSvg).join('');
  } else if (comp.kind === 'buzzer') {
    inner = `<circle id="bb-buz-${comp.id}" cx="20" cy="20" r="16" class="bb-buz-body"/><circle cx="20" cy="20" r="7" class="bb-buz-hole"/>` +
      `<text x="20" y="62" text-anchor="middle" class="bb-comp-label">${esc(comp.label)}</text>` +
      terms.map(termSvg).join('');
  }
  return `<g class="bb-comp${sel}${hl}" data-comp="${comp.id}" transform="translate(${comp.x},${comp.y})">${inner}</g>`;
}

function renderBreadboard() {
  const netColorByRoot = new Map(mapping.nets.map((n) => [n.id, n.color]));
  let s = renderRails() + renderChip();
  // Dây (vẽ dưới linh kiện để đầu nối luôn bấm được)
  for (const w of netlist.wires) {
    // Vị trí 2 đầu; VCC/GND chọn điểm nối gần đầu kia nhất cho gọn
    let p1 = termPos(w.a), p2 = termPos(w.b);
    if (!p1 || !p2) continue;
    if (w.a === 'VCC' || w.a === 'GND') p1 = termPos(w.a, p2.y);
    if (w.b === 'VCC' || w.b === 'GND') p2 = termPos(w.b, p1.y);
    const root = mapping.netOf.get(w.a);
    const color = netColorByRoot.get(root) || '#2563EB';
    const hl = highlight && highlight.wireIds && highlight.wireIds.includes(w.id);
    const sel = selectedWireId === w.id;
    const d = wirePath(p1.x, p1.y, p2.x, p2.y);
    s += `<path d="${d}" class="bb-wire-hit" data-wire="${w.id}"><title>Dây ${w.a} ↔ ${w.b} — bấm để chọn</title></path>`;
    s += `<path d="${d}" class="bb-wire${sel ? ' selected' : ''}${hl ? ' hl' : ''}" data-wire="${w.id}" stroke="${color}"><title>Dây ${w.a} ↔ ${w.b}</title></path>`;
  }
  // Đường kéo dây đang dang dở
  if (dragTerm) {
    const p = termPos(dragTerm);
    const cur = dragCurrent;
    if (p && cur) s += `<path d="${wirePath(p.x, p.y, cur.x, cur.y)}" class="bb-wire-preview"/>`;
  }
  for (const c of netlist.components) s += renderComponent(c);
  bbSvg.innerHTML = s;
  $('btnDeleteWire').disabled = !selectedWireId;
  $('btnDeleteComp').disabled = !selectedCompId || !netlist.components.find((c) => c.id === selectedCompId && !c.fixed);
}

// Cập nhật phần "sống" trên breadboard mà không vẽ lại toàn bộ SVG
function updateBreadboardLive() {
  if (!bbSvg || !bbSvg.querySelector('.bb-comp')) return;
  for (const st of ledStates(cpu, mapping)) {
    const el = document.getElementById('bb-led-' + st.id);
    if (el) el.classList.toggle('on', st.on);
  }
  if (mapping.lcd.id) {
    const [l0, l1] = cpu.lcd.getLines();
    const ok = mapping.lcd.complete;
    const t0 = document.getElementById('bb-lcd-' + mapping.lcd.id + '-0');
    const t1 = document.getElementById('bb-lcd-' + mapping.lcd.id + '-1');
    if (t0) t0.textContent = ok ? l0 : 'CHUA NOI DU DAY';
    if (t1) t1.textContent = ok ? l1 : '                ';
  }
  for (const b of mapping.buzzers) {
    const el = document.getElementById('bb-buz-' + b.id);
    if (el) {
      const on = !!b.pin && cpu.pinDirection(b.pin.port, b.pin.bit) === 'out' && cpu.pinLevel(b.pin.port, b.pin.bit) === 1;
      el.classList.toggle('on', on);
    }
  }
}

function renderChecks() {
  const list = $('checksList');
  const warns = checkWiring(netlist, cpu.tris);
  if (!warns.length) {
    list.innerHTML = `<li class="check-ok">Mạch ổn — không phát hiện vấn đề đấu nối.</li>`;
    return;
  }
  list.innerHTML = warns.map((w, i) =>
    `<li><button type="button" class="check-item ${w.kind === 'short' ? 'check-short' : 'check-warn'}" data-warn="${i}">${esc(w.message)}</button></li>`).join('');
  list.querySelectorAll('.check-item').forEach((btn) => btn.addEventListener('click', () => {
    highlight = warns[Number(btn.dataset.warn)];
    renderBreadboard();
    $('bbStatus').textContent = 'Đã tô sáng dây/linh kiện liên quan tới cảnh báo này.';
  }));
}

function setBbStatus(t) { $('bbStatus').textContent = t; }

function applyWiring() {
  mapping = resolvePeripherals(netlist);
  cpu.setWiring(mapping);
  saveWiring();
  selectedWireId = null; selectedCompId = null; pendingTerm = null; highlight = null;
  renderBoard();
  renderBreadboard();
  renderChecks();
  applyAllPots();
  refreshAll();
}

function tryAddWire(a, b) {
  if (a === b) { setBbStatus('Hai đầu nối trùng nhau — chọn 2 đầu khác nhau.'); return false; }
  const dup = netlist.wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  if (dup) { setBbStatus('Đã có dây nối 2 đầu này rồi.'); return false; }
  const { netOf } = resolvePeripherals(netlist);
  if (netOf.get(a) && netOf.get(a) === netOf.get(b)) {
    setBbStatus('Hai đầu này đã cùng một net rồi, không cần nối thêm dây.');
    return false;
  }
  netlist.wires.push({ id: 'W' + (wireSeq++), a, b });
  applyWiring();
  setBbStatus(`Đã nối ${a} ↔ ${b}.`);
  return true;
}

function deleteSelected() {
  if (selectedWireId) {
    netlist.wires = netlist.wires.filter((w) => w.id !== selectedWireId);
    applyWiring();
    setBbStatus('Đã gỡ dây.');
    return;
  }
  if (selectedCompId) {
    const comp = netlist.components.find((c) => c.id === selectedCompId);
    if (comp && comp.fixed) { setBbStatus('Linh kiện của mạch mẫu không xoá được — chỉ xoá dây của nó.'); return; }
    if (comp) {
      netlist.components = netlist.components.filter((c) => c.id !== selectedCompId);
      netlist.wires = netlist.wires.filter((w) => !w.a.startsWith(selectedCompId + '.') && !w.b.startsWith(selectedCompId + '.'));
      applyWiring();
      setBbStatus(`Đã xoá ${comp.label}.`);
    }
  }
}

// Vị trí đặt linh kiện mới: lưới ô trống phía dưới-phải (LCD mới đặt riêng)
function nextSlot(kind) {
  if (kind === 'lcd') return { x: 640, y: 640 };
  const used = new Set(netlist.components.map((c) => c.x + ',' + c.y));
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 640 + col * 120, y = 300 + row * 130;
      if (!used.has(x + ',' + y)) return { x, y };
    }
  }
  return { x: 640, y: 300 + netlist.components.length * 20 };
}
function addComponent(kind) {
  const id = nextComponentId(netlist, kind);
  const { x, y } = nextSlot(kind);
  const comp = createComponent(kind, id, x, y);
  netlist.components.push(comp);
  applyWiring();
  setBbStatus(`Đã thêm ${comp.label} — kéo dây từ các đầu nối của nó (đầu nối chưa nối sẽ hiện trong panel Kiểm tra).`);
}
document.querySelectorAll('.palette [data-add]').forEach((b) =>
  b.addEventListener('click', () => addComponent(b.dataset.add)));
$('btnResetWiring').addEventListener('click', () => {
  netlist = defaultNetlist();
  applyWiring();
  setBbStatus('Đã về mạch mẫu: LED PORTB, nút RC0–RC3, LCD PORTD/RE0/RE1, chiết áp AN0.');
});
$('btnDeleteWire').addEventListener('click', deleteSelected);
$('btnDeleteComp').addEventListener('click', deleteSelected);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !$('breadboardView').hidden
    && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    if (selectedWireId || selectedCompId) { e.preventDefault(); deleteSelected(); }
  }
});

// --- Chuyển tab Board / Breadboard ---
function switchView(bread) {
  $('viewBoardBtn').classList.toggle('active', !bread);
  $('viewBreadBtn').classList.toggle('active', bread);
  $('viewBoardBtn').setAttribute('aria-selected', String(!bread));
  $('viewBreadBtn').setAttribute('aria-selected', String(bread));
  document.querySelector('.workspace').hidden = bread;
  $('breadboardView').hidden = !bread;
  if (bread) { renderBreadboard(); renderChecks(); updateBreadboardLive(); }
}
$('viewBoardBtn').addEventListener('click', () => switchView(false));
$('viewBreadBtn').addEventListener('click', () => switchView(true));

// --- Kéo dây: pointer events trên SVG ---
function svgPoint(e) {
  const pt = new DOMPoint(e.clientX, e.clientY);
  return pt.matrixTransform(bbSvg.getScreenCTM().inverse());
}
bbSvg.addEventListener('pointerdown', (e) => {
  const term = e.target.closest('.bb-term');
  const wire = e.target.closest('.bb-wire-hit, .bb-wire');
  const comp = e.target.closest('.bb-comp');
  downTarget = term ? { type: 'term', id: term.dataset.term }
    : wire ? { type: 'wire', id: wire.dataset.wire }
    : comp ? { type: 'comp', id: comp.dataset.comp } : null;
  dragMoved = false;
  dragStartXY = { x: e.clientX, y: e.clientY };
  if (term) {
    dragTerm = term.dataset.term;
    dragCurrent = svgPoint(e);
    bbSvg.setPointerCapture(e.pointerId);
  }
});
bbSvg.addEventListener('pointermove', (e) => {
  if (!dragTerm) return;
  if (dragStartXY && Math.hypot(e.clientX - dragStartXY.x, e.clientY - dragStartXY.y) > 6) dragMoved = true;
  dragCurrent = svgPoint(e);
  // Vẽ lại chỉ để cập nhật đường preview (giữ nguyên các phần tử khác)
  const old = bbSvg.querySelector('.bb-wire-preview');
  if (old) old.remove();
  const p = termPos(dragTerm);
  if (p && dragCurrent) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', wirePath(p.x, p.y, dragCurrent.x, dragCurrent.y));
    path.setAttribute('class', 'bb-wire-preview');
    bbSvg.appendChild(path);
  }
});
bbSvg.addEventListener('pointerup', (e) => {
  if (dragTerm) {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bb-term');
    const start = dragTerm;
    dragTerm = null; dragCurrent = null;
    const preview = bbSvg.querySelector('.bb-wire-preview');
    if (preview) preview.remove();
    if (dragMoved) {
      // Kéo-thả: thả lên đầu nối khác thì nối dây
      if (target && target.dataset.term !== start) tryAddWire(start, target.dataset.term);
      else renderBreadboard();
    } else {
      // Bấm-chạm: bấm lần lượt 2 đầu nối (cho mobile)
      if (pendingTerm === null) {
        pendingTerm = start;
        setBbStatus(`Đã chọn đầu ${start} — bấm thêm một đầu nối khác để nối dây.`);
      } else if (pendingTerm === start) {
        pendingTerm = null;
        setBbStatus('Đã bỏ chọn đầu nối.');
      } else {
        const a = pendingTerm;
        pendingTerm = null;
        tryAddWire(a, start);
      }
      renderBreadboard();
    }
    return;
  }
  // Bấm chọn dây / linh kiện (không kéo)
  if (downTarget && !dragMoved) {
    if (downTarget.type === 'wire') {
      selectedWireId = downTarget.id; selectedCompId = null;
      renderBreadboard();
      setBbStatus('Đã chọn một dây — bấm "Xoá dây đã chọn" hoặc phím Delete để gỡ.');
    } else if (downTarget.type === 'comp') {
      selectedCompId = downTarget.id; selectedWireId = null;
      renderBreadboard();
      const comp = netlist.components.find((c) => c.id === downTarget.id);
      setBbStatus(comp && comp.fixed
        ? `${comp.label} là linh kiện mạch mẫu (không xoá được), nhưng có thể gỡ/sửa dây của nó.`
        : `Đã chọn ${comp ? comp.label : ''} — bấm "Xoá linh kiện" để gỡ khỏi breadboard.`);
    } else {
      selectedWireId = null; selectedCompId = null;
      renderBreadboard();
    }
  }
  downTarget = null;
});
bbSvg.addEventListener('pointercancel', () => {
  dragTerm = null; dragCurrent = null;
  const preview = bbSvg.querySelector('.bb-wire-preview');
  if (preview) preview.remove();
  renderBreadboard();
});
