// app.js — Nối UI với lõi pic16.js (DOM + vòng lặp chạy + board + panel giám sát).
import { assemble, createCPU, parseIntelHex, exportHex, disassemble } from './pic16.js?v=20261125a';
import { EXAMPLES } from './examples.js?v=20261125a';

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
let potVolts = 0;

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
    cpu.setAnalog(0, potVolts);
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
  cpu.setAnalog(0, potVolts);
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

// --- Board: LED, nút nhấn, chiết áp, LCD, UART ---
const ledsBox = $('leds');
ledsBox.innerHTML = Array.from({ length: 8 }, (_, b) =>
  `<div class="led-cell"><div class="led" id="led${b}" aria-label="LED RB${b}"></div><span>RB${b}</span></div>`).join('');
const pushBox = $('pushBtns');
pushBox.innerHTML = [0, 1, 2, 3].map((b) =>
  `<button type="button" class="push-btn" data-bit="${b}" aria-label="Nút nhấn RC${b}">RC${b}</button>`).join('');
pushBox.querySelectorAll('.push-btn').forEach((btn) => {
  const bit = Number(btn.dataset.bit);
  const press = (e) => { e.preventDefault(); btn.classList.add('pressed'); cpu.setPinInput(2, bit, 0); refreshAll(); };
  const release = () => { btn.classList.remove('pressed'); cpu.setPinInput(2, bit, 1); refreshAll(); };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); press(e); } });
  btn.addEventListener('keyup', release);
});
$('pot').addEventListener('input', (e) => {
  potVolts = Number(e.target.value);
  cpu.setAnalog(0, potVolts);
  refreshPot();
});
function refreshPot() {
  const adc = Math.round((potVolts / 5) * 1023);
  $('potValue').textContent = `${potVolts.toFixed(2)} V · ADC ≈ ${adc}`;
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
  cpu.setAnalog(0, potVolts);
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
  // LED
  for (let b = 0; b < 8; b++) $('led' + b).classList.toggle('on', cpu.pinLevel(1, b) === 1 && cpu.pinDirection(1, b) === 'out');
  // LCD
  const [l0, l1] = cpu.lcd.getLines();
  $('lcdLine0').textContent = l0;
  $('lcdLine1').textContent = l1;
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
  refreshPot();
  drawLogic();
}

// --- Khởi động ---
$('labTitle').textContent = 'Bài học: Nhấp nháy LED RB0';
loadExample('blink');
refreshAll();
