/**
 * MATTEP Anti-Cheat System v4.0
 * ระบบตรวจจับพฤติกรรมผิดปกติระหว่างการสอบแบบทำงานในเครื่องผู้ใช้
 */

class AntiCheat {
  constructor() {
    this.suspicionScore = 0;
    this.violations = [];
    this.timeline = [];
    this.examStartTime = Date.now();
    this.lastEventTime = {};
    this.lastVisibilityHiddenAt = null;
    this.lastAnswerAt = null;
    this.answerTiming = {
      rapidAnswers: 0,
      answered: {},
      intervals: [],
    };
    this.typingStats = {
      keyCount: 0,
      pasteBursts: 0,
      fastBursts: 0,
      lastKeyAt: null,
      intervals: [],
    };
    this.mouseStats = {
      moves: 0,
      clicks: 0,
      distance: 0,
      lastX: null,
      lastY: null,
      lastMoveAt: 0,
    };
    this.eventCounts = {
      devtools: 0,
      tabSwitch: 0,
      paste: 0,
      copy: 0,
      cut: 0,
      rightClick: 0,
      screenshot: 0,
      typing: 0,
      mouse: 0,
      answerTiming: 0,
      pattern: 0,
      fullscreen: 0,
      storage: 0,
      print: 0,
      search: 0,
    };
    this.thresholds = { warning: 40, highRisk: 65, cheating: 85 };
    this.init();
  }

  init() {
    this._setupListeners();
    this._guardStorageApis();
    this._monitorDevtoolsResize();
    this._startPatternLoop();
    this._showStatus();
  }

  _setupListeners() {
    document.addEventListener('keydown', (e) => this._onKeyDown(e), true);
    document.addEventListener('visibilitychange', () => this._onVisibilityChange());
    window.addEventListener('blur', () => this._onBlur());
    window.addEventListener('beforeprint', (e) => this._onBeforePrint(e));
    window.addEventListener('storage', (e) => this._onStorageChange(e));

    document.addEventListener('copy', (e) => this._onCopy(e), true);
    document.addEventListener('paste', (e) => this._onPaste(e), true);
    document.addEventListener('cut', (e) => this._onCut(e), true);
    document.addEventListener('contextmenu', (e) => this._onContextMenu(e), true);
    document.addEventListener('dragstart', (e) => e.preventDefault(), true);

    document.addEventListener('input', (e) => this._analyzeInput(e), true);
    document.addEventListener('change', (e) => this._analyzeAnswerTiming(e), true);
    document.addEventListener('mousemove', (e) => this._analyzeMouseMove(e), { passive: true, capture: true });
    document.addEventListener('click', () => { this.mouseStats.clicks++; }, true);
  }

  _isEditableTarget(target) {
    return target && (target.matches?.('input, textarea, [contenteditable="true"]') || target.closest?.('input, textarea, [contenteditable="true"]'));
  }

  _isRecent(key, ms = 1800) {
    const now = Date.now();
    if (this.lastEventTime[key] && now - this.lastEventTime[key] < ms) return true;
    this.lastEventTime[key] = now;
    return false;
  }

  _onKeyDown(e) {
    const key = e.key.toUpperCase();
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(key)) || (e.ctrlKey && key === 'U')) {
      e.preventDefault();
      this._addViolation('DevTools Attempt', 30, 'devtools', `Key: ${e.key}`);
      return;
    }

    if (e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's')) {
      e.preventDefault();
      this._addViolation('Screenshot Attempt', 30, 'screenshot', 'พยายามแคปหน้าจอ');
      this._blackout(2500);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const shortcuts = {
        C: ['Copy Shortcut', 'copy', 6],
        X: ['Cut Shortcut', 'cut', 8],
        P: ['Print Shortcut', 'print', 20],
        F: ['Search Shortcut', 'search', 12],
      };
      const hit = shortcuts[key];
      if (hit) {
        e.preventDefault();
        this._addViolation(hit[0], hit[2], hit[1], `Ctrl/Cmd + ${key}`);
      }
    }

    if (this._isEditableTarget(e.target) && e.key.length === 1) {
      const now = Date.now();
      this.typingStats.keyCount++;
      if (this.typingStats.lastKeyAt) {
        this.typingStats.intervals.push(now - this.typingStats.lastKeyAt);
      }
      this.typingStats.lastKeyAt = now;
    }
  }

  _onVisibilityChange() {
    if (document.hidden) {
      this.lastVisibilityHiddenAt = Date.now();
      this._addViolation('Tab Hidden', 12, 'tabSwitch', 'ออกจากหน้าเว็บสอบ');
      return;
    }

    if (this.lastVisibilityHiddenAt) {
      const awayMs = Date.now() - this.lastVisibilityHiddenAt;
      if (awayMs > 5000) {
        this._addViolation('Away From Exam', 18, 'tabSwitch', `ออกจากหน้า ${Math.round(awayMs / 1000)} วินาที`);
      }
      this.lastVisibilityHiddenAt = null;
    }
  }

  _onBlur() {
    if (!window.__mattepSubmitting && !this._isRecent('blur', 2500)) {
      this._addViolation('Window Blur', 8, 'tabSwitch', 'หน้าต่างสอบไม่ได้อยู่ด้านหน้า');
    }
  }

  _onCopy(e) {
    if (this._isEditableTarget(e.target)) return;
    e.preventDefault();
    this._addViolation('Copy Attempt', 8, 'copy', 'คัดลอกข้อความนอกช่องตอบ');
  }

  _onPaste(e) {
    if (!this._isEditableTarget(e.target)) {
      e.preventDefault();
      this._addViolation('Paste Attempt', 12, 'paste', 'วางข้อความนอกช่องตอบ');
      return;
    }

    const text = e.clipboardData?.getData('text') || '';
    this.typingStats.pasteBursts++;
    if (text.trim().length > 60) {
      this._addViolation('Large Paste', 18, 'paste', `วางข้อความ ${text.trim().length} ตัวอักษร`);
    } else {
      this._addViolation('Paste In Answer', 8, 'paste', 'มีการวางข้อความในคำตอบ');
    }
  }

  _onCut(e) {
    if (this._isEditableTarget(e.target)) return;
    e.preventDefault();
    this._addViolation('Cut Attempt', 8, 'cut', 'ตัดข้อความนอกช่องตอบ');
  }

  _onContextMenu(e) {
    if (this._isEditableTarget(e.target)) return;
    e.preventDefault();
    this._addViolation('Right Click', 5, 'rightClick', 'คลิกขวา');
  }

  _onBeforePrint(e) {
    e.preventDefault();
    this._addViolation('Print Attempt', 22, 'print', 'พยายามพิมพ์หรือบันทึกเป็น PDF');
  }

  _onStorageChange(e) {
    if (e.key === 'mattepExamRecords' || e.key === 'examSubmission') {
      this._addViolation('Storage Changed', 22, 'storage', 'ข้อมูลสอบในเครื่องถูกเปลี่ยนระหว่างสอบ');
    }
  }

  _analyzeInput(e) {
    if (!this._isEditableTarget(e.target)) return;
    const value = e.target.value || '';
    if (value.length > 120 && this.typingStats.keyCount < 8 && !this._isRecent('bulk-input', 3000)) {
      this._addViolation('Bulk Text Input', 16, 'typing', 'ข้อความยาวถูกใส่เร็วผิดปกติ');
    }
  }

  _analyzeAnswerTiming(e) {
    if (!e.target?.matches?.('input[type="radio"]')) return;
    const name = e.target.name;
    if (!/^q\d+$/.test(name) || this.answerTiming.answered[name]) return;

    const now = Date.now();
    this.answerTiming.answered[name] = now;

    // คำนวณช่วงเวลา: ถ้าเป็นข้อแรกใช้เวลาเริ่มสอบ ถ้าไม่ใช่ใช้เวลาข้อก่อนหน้า
    const referenceTime = this.lastAnswerAt || this.examStartTime;
    const interval = now - referenceTime;
    const qNum = parseInt(name.substring(1));
    if (qNum > 0) this.answerTiming.intervals[qNum - 1] = interval;

    if (interval < 1200) {
      this.answerTiming.rapidAnswers++;
      this._addViolation('Rapid Answer', 7, 'answerTiming', `ตอบห่างกัน ${Math.round(interval)} ms`);
    }
    this.lastAnswerAt = now;
  }

  _analyzeMouseMove(e) {
    const now = Date.now();
    if (now - this.mouseStats.lastMoveAt < 140) return;
    this.mouseStats.lastMoveAt = now;
    this.mouseStats.moves++;

    if (this.mouseStats.lastX !== null) {
      const dx = e.clientX - this.mouseStats.lastX;
      const dy = e.clientY - this.mouseStats.lastY;
      this.mouseStats.distance += Math.round(Math.hypot(dx, dy));
    }
    this.mouseStats.lastX = e.clientX;
    this.mouseStats.lastY = e.clientY;
  }

  _guardStorageApis() {
    const originalSetItem = Storage.prototype.setItem;
    const self = this;
    Storage.prototype.setItem = function(key, value) {
      if (!window.__mattepSubmitting && (key === 'mattepExamRecords' || key === 'examSubmission')) {
        self._addViolation('Storage Write', 18, 'storage', `เขียนข้อมูล ${key}`);
      }
      return originalSetItem.apply(this, arguments);
    };
  }

  _monitorDevtoolsResize() {
    setInterval(() => {
      const widthGap = Math.abs(window.outerWidth - window.innerWidth);
      const heightGap = Math.abs(window.outerHeight - window.innerHeight);
      if ((widthGap > 180 || heightGap > 220) && !this._isRecent('devtools-resize', 6000)) {
        this._addViolation('Possible DevTools', 18, 'devtools', 'ขนาดหน้าต่างคล้ายเปิดเครื่องมือนักพัฒนา');
      }
    }, 4000);
  }

  _startPatternLoop() {
    setInterval(() => {
      const intervals = this.typingStats.intervals.slice(-20);
      if (intervals.length >= 12) {
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avg < 65 && !this._isRecent('typing-pattern', 8000)) {
          this.typingStats.fastBursts++;
          this._addViolation('Fast Typing Pattern', 10, 'typing', 'ความเร็วพิมพ์สม่ำเสมอผิดปกติ');
        }
      }
    }, 5000);
  }

  _blackout(duration) {
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;background:#020617;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font:700 18px sans-serif;z-index:9999;padding:24px;';
    cover.textContent = 'ระบบป้องกันการแคปหน้าจอทำงาน กรุณากลับมาทำข้อสอบต่อ';
    document.body.appendChild(cover);
    setTimeout(() => cover.remove(), duration);
  }

  _showStatus() {
    const badge = document.createElement('div');
    badge.id = 'antiCheatStatus';
    badge.textContent = 'AI Anti-Cheat กำลังทำงาน';
    badge.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:30;background:#0f172a;color:#fff;border-radius:999px;padding:8px 12px;font:700 12px "Noto Sans Thai",sans-serif;box-shadow:0 10px 24px rgba(15,23,42,.2);opacity:.88;pointer-events:none;';
    if (document.body) {
      document.body.appendChild(badge);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.body.appendChild(badge), { once: true });
    }
  }

  _addViolation(type, points, category, details = '') {
    if (this._isRecent(`${type}:${details}`, 1200)) return;
    this.eventCounts[category] = (this.eventCounts[category] || 0) + 1;
    this.suspicionScore = Math.min(100, this.suspicionScore + points);

    const event = {
      type,
      category,
      details,
      points,
      description: this._describe(type),
      time: new Date().toLocaleTimeString('th-TH'),
      timestamp: new Date().toISOString(),
    };
    this.violations.push(event);
    this.timeline.push(event);

    // แจ้งเตือนระบบภายนอกทันทีเมื่อพบการทำผิดกฎ (Real-time trigger)
    document.dispatchEvent(new CustomEvent('antiCheatViolation', { detail: event }));
  }

  _describe(type) {
    const labels = {
      'DevTools Attempt': 'พยายามเปิดเครื่องมือนักพัฒนา',
      'Screenshot Attempt': 'พยายามแคปหน้าจอ',
      'Tab Hidden': 'ออกจากแท็บข้อสอบ',
      'Away From Exam': 'ออกจากหน้าสอบนานผิดปกติ',
      'Window Blur': 'สลับไปหน้าต่างอื่น',
      'Copy Attempt': 'พยายามคัดลอกข้อความ',
      'Paste Attempt': 'พยายามวางข้อความ',
      'Paste In Answer': 'วางข้อความในช่องคำตอบ',
      'Large Paste': 'วางข้อความจำนวนมาก',
      'Cut Attempt': 'พยายามตัดข้อความ',
      'Right Click': 'คลิกขวาระหว่างสอบ',
      'Print Attempt': 'พยายามพิมพ์หรือบันทึกผล',
      'Storage Changed': 'ข้อมูลสอบถูกเปลี่ยนจากแท็บอื่น',
      'Storage Write': 'มีการเขียนข้อมูลสอบระหว่างสอบ',
      'Bulk Text Input': 'ใส่ข้อความยาวอย่างรวดเร็ว',
      'Rapid Answer': 'ตอบข้อสอบเร็วผิดปกติ',
      'Possible DevTools': 'รูปแบบหน้าต่างคล้ายเปิด DevTools',
      'Fast Typing Pattern': 'รูปแบบการพิมพ์ผิดปกติ',
    };
    return labels[type] || type;
  }

  _riskLevel() {
    if (this.suspicionScore >= this.thresholds.cheating) return 'CHEATING';
    if (this.suspicionScore >= this.thresholds.highRisk) return 'HIGH RISK';
    if (this.suspicionScore >= this.thresholds.warning) return 'WARNING';
    return 'SAFE';
  }

  getAnalysisReport() {
    const runtimeMs = Date.now() - this.examStartTime;
    const minutes = Math.floor(runtimeMs / 60000);
    const seconds = Math.floor((runtimeMs % 60000) / 1000);
    const answeredCount = Object.keys(this.answerTiming.answered).length;
    const avgInterval = this.answerTiming.intervals.length
      ? Math.round(this.answerTiming.intervals.reduce((a, b) => a + b, 0) / this.answerTiming.intervals.length)
      : null;

    return {
      suspicionScore: Math.round(this.suspicionScore),
      riskLevel: this._riskLevel(),
      runtime: { ms: runtimeMs, formatted: `${minutes}:${String(seconds).padStart(2, '0')}` },
      violations: this.violations.slice(-80),
      violationCount: this.violations.length,
      statistics: { ...this.eventCounts },
      typingStats: {
        ...this.typingStats,
        averageInterval: this.typingStats.intervals.length
          ? Math.round(this.typingStats.intervals.reduce((a, b) => a + b, 0) / this.typingStats.intervals.length)
          : null,
      },
      mouseStats: { ...this.mouseStats },
      answerTiming: {
        rapidAnswers: this.answerTiming.rapidAnswers,
        answeredCount,
        averageInterval: avgInterval,
        intervals: this.answerTiming.intervals,
      },
      timeline: this.timeline.slice(-120),
      timestamp: new Date().toLocaleString('th-TH'),
    };
  }
}

window.antiCheat = window.__mattepPcOnlyBlocked ? null : new AntiCheat();