
/**
 * MATTEP Anti-Cheat System v4.0
 * ระบบตรวจจับพฤติกรรมผิดปกติระหว่างการสอบแบบทำงานในเครื่องผู้ใช้
 */

class AntiCheat {
  constructor() {
    // สถานะพื้นฐานของการสอบ
    this.suspicionScore = 0; // คะแนนสะสมความเสี่ยงการโกง
    this.violations = [];
    this.timeline = [];
    this.examStartTime = Date.now();
    this.lastEventTime = {};
    this.lastVisibilityHiddenAt = null;
    this.lastAnswerAt = null;

    // สถิติการตอบคำถาม (ใช้หาคนที่ตอบเร็วผิดปกติ/บอท)
    this.answerTiming = {
      rapidAnswers: 0,
      answered: {},
      intervals: [],
    };

    // สถิติการพิมพ์ (ใช้ตรวจจับการวางข้อความหรือมาโคร)
    this.typingStats = {
      keyCount: 0,
      pasteBursts: 0,
      fastBursts: 0,
      lastKeyAt: null,
      intervals: [],
    };

    // สถิติการใช้เมาส์ (ตรวจจับบอทที่ไม่มีการขยับเมาส์)
    this.mouseStats = {
      moves: 0,
      clicks: 0,
      distance: 0,
      lastX: null,
      lastY: null,
      lastMoveAt: 0,
    };

    // ตัวนับจำนวนครั้งที่ทำผิดกฎในแต่ละหมวดหมู่
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
      aiDetection: 0, // เพิ่มหมวดหมู่สถิติสำหรับกล้อง AI
    };
    this.thresholds = Soer.thresholds;
    this.init();
  }

  /**
   * เริ่มต้นการทำงานของระบบ Anti-Cheat (ดักจับ Event ต่างๆ)
   */
  init() {
    this._setupListeners();
    this._guardStorageApis();
    this._monitorDevtoolsResize();
    this._startPatternLoop();
    this._showStatus();
  }

  /**
   * ผูก Event Listener เข้ากับ Window/Document เพื่อดักพฤติกรรม
   */
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

  /**
   * ตรวจสอบว่าเป้าหมายที่ผู้ใช้กำลังกระทำอยู่เป็นช่องกรอกข้อความหรือไม่
   * (เพื่อป้องกันการแจ้งเตือนผิดพลาดเวลาผู้ใช้กดคีย์บอร์ดพิมพ์งานปกติ)
   */
  _isEditableTarget(target) {
    return target && (target.matches?.('input, textarea, [contenteditable="true"]') || target.closest?.('input, textarea, [contenteditable="true"]'));
  }

  /**
   * ป้องกันการบันทึกการโกงซ้ำซ้อนในช่วงเวลาสั้นๆ (Cooldown/Debounce)
   * @returns {boolean} true ถ้ายกเว้น (พึ่งเกิดเหตุการณ์นี้ไป)
   */
  _isRecent(key, ms = Soer.timing.defaultRecentMs) {
    const now = Date.now();
    if (this.lastEventTime[key] && now - this.lastEventTime[key] < ms) return true;
    this.lastEventTime[key] = now;
    return false;
  }

  /**
   * ดักจับการกดคีย์บอร์ด (ป้องกันปุ่ม F12, PrintScreen, คีย์ลัดต่างๆ)
   */
  _onKeyDown(e) {
    const key = e.key.toUpperCase();
    // ตรวจจับการพยายามเปิด DevTools (F12, Ctrl+Shift+I/J/C, Ctrl+U)
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(key)) || (e.ctrlKey && key === 'U')) {
      e.preventDefault();
      this._addViolation('DevTools Attempt', Soer.points.devtools, 'devtools', `Key: ${e.key}`);
      return;
    }

    // ตรวจจับการแคปหน้าจอ (PrintScreen, Ctrl+Shift+S)
    if (e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's')) {
      e.preventDefault();
      this._addViolation('Screenshot Attempt', Soer.points.screenshot, 'screenshot', 'พยายามแคปหน้าจอ');
      this._blackout(Soer.timing.blackoutDuration);
      return;
    }

    // ตรวจจับคีย์ลัดอื่นๆ เช่น Copy, Cut, Print, ค้นหา (Ctrl+F)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const shortcuts = {
        C: ['Copy Shortcut', 'copy', Soer.points.copyShortcut],
        X: ['Cut Shortcut', 'cut', Soer.points.cutShortcut],
        P: ['Print Shortcut', 'print', Soer.points.printShortcut],
        F: ['Search Shortcut', 'search', Soer.points.searchShortcut],
      };
      const hit = shortcuts[key];
      if (hit) {
        e.preventDefault();
        this._addViolation(hit[0], hit[2], hit[1], `Ctrl/Cmd + ${key}`);
      }
    }

    // เก็บสถิติความเร็วการพิมพ์เพื่อหาพฤติกรรมผิดปกติ (พิมพ์เร็วเท่ากันเป๊ะๆ แบบมาโคร)
    if (this._isEditableTarget(e.target) && e.key.length === 1) {
      const now = Date.now();
      this.typingStats.keyCount++;
      if (this.typingStats.lastKeyAt) {
        this.typingStats.intervals.push(now - this.typingStats.lastKeyAt);
      }
      this.typingStats.lastKeyAt = now;
    }
  }

  /**
   * ตรวจจับเมื่อผู้ใช้สลับไปแท็บอื่น หรือพับหน้าต่างเบราว์เซอร์
   */
  _onVisibilityChange() {
    if (document.hidden) {
      this.lastVisibilityHiddenAt = Date.now();
      this._addViolation('Tab Hidden', Soer.points.tabHidden, 'tabSwitch', 'ออกจากหน้าเว็บสอบ');
      return;
    }

    if (this.lastVisibilityHiddenAt) {
      const awayMs = Date.now() - this.lastVisibilityHiddenAt;
      if (awayMs > Soer.timing.awayFromExamMs) {
        this._addViolation('Away From Exam', Soer.points.awayFromExam, 'tabSwitch', `ออกจากหน้า ${Math.round(awayMs / 1000)} วินาที`);
      }
      this.lastVisibilityHiddenAt = null;
    }
  }

  /**
   * ตรวจจับเมื่อหน้าต่างเบราว์เซอร์สูญเสียการโฟกัส (คลิกไปเปิดโปรแกรมอื่น)
   */
  _onBlur() {
    if (!window.__mattepSubmitting && !this._isRecent('blur', Soer.timing.blurCooldownMs)) {
      this._addViolation('Window Blur', Soer.points.windowBlur, 'tabSwitch', 'หน้าต่างสอบไม่ได้อยู่ด้านหน้า');
    }
  }

  /**
   * ตรวจจับความพยายามคัดลอกข้อความ
   */
  _onCopy(e) {
    if (this._isEditableTarget(e.target)) return;
    e.preventDefault();
    this._addViolation('Copy Attempt', Soer.points.copyAttempt, 'copy', 'คัดลอกข้อความนอกช่องตอบ');
  }

  /**
   * ตรวจจับการวางข้อความ (ป้องกันก๊อปปี้คำตอบมาแปะ)
   */
  _onPaste(e) {
    if (!this._isEditableTarget(e.target)) {
      e.preventDefault();
      this._addViolation('Paste Attempt', Soer.points.pasteAttempt, 'paste', 'วางข้อความนอกช่องตอบ');
      return;
    }

    const text = e.clipboardData?.getData('text') || '';
    this.typingStats.pasteBursts++;
    if (text.trim().length > Soer.limits.largePasteLength) {
      this._addViolation('Large Paste', Soer.points.largePaste, 'paste', `วางข้อความ ${text.trim().length} ตัวอักษร`);
    } else {
      this._addViolation('Paste In Answer', Soer.points.pasteInAnswer, 'paste', 'มีการวางข้อความในคำตอบ');
    }
  }

  /**
   * ตรวจจับการตัดข้อความ (Cut)
   */
  _onCut(e) {
    if (this._isEditableTarget(e.target)) return;
    e.preventDefault();
    this._addViolation('Cut Attempt', Soer.points.cutAttempt, 'cut', 'ตัดข้อความนอกช่องตอบ');
  }

  /**
   * ดักการคลิกขวา เพื่อป้องกันการ Inspect Element หรือใช้ตัวช่วย
   */
  _onContextMenu(e) {
    if (this._isEditableTarget(e.target)) return;
    e.preventDefault();
    this._addViolation('Right Click', Soer.points.rightClick, 'rightClick', 'คลิกขวา');
  }

  /**
   * ดักการสั่งพิมพ์หน้าจอ (Ctrl+P) หรือเซฟเป็น PDF
   */
  _onBeforePrint(e) {
    e.preventDefault();
    this._addViolation('Print Attempt', Soer.points.printAttempt, 'print', 'พยายามพิมพ์หรือบันทึกเป็น PDF');
  }

  /**
   * ตรวจจับการพยายามแฮ็กระบบผ่านการแก้ไข LocalStorage ของเบราว์เซอร์
   */
  _onStorageChange(e) {
    if (e.key === 'mattepExamRecords' || e.key === 'examSubmission') {
      this._addViolation('Storage Changed', Soer.points.storageChanged, 'storage', 'ข้อมูลสอบในเครื่องถูกเปลี่ยนระหว่างสอบ');
    }
  }

  /**
   * วิเคราะห์การกรอกข้อความยาวๆ อย่างรวดเร็ว (อาจใช้ Auto-fill หรือบอท)
   */
  _analyzeInput(e) {
    if (!this._isEditableTarget(e.target)) return;
    const value = e.target.value || '';
    if (value.length > Soer.limits.bulkInputLength && this.typingStats.keyCount < Soer.limits.bulkInputMaxKeys && !this._isRecent('bulk-input', Soer.timing.bulkInputCooldownMs)) {
      this._addViolation('Bulk Text Input', Soer.points.bulkInput, 'typing', 'ข้อความยาวถูกใส่เร็วผิดปกติ');
    }
  }

  /**
   * วิเคราะห์ระยะเวลาการตอบข้อสอบ (หาคนที่ตอบเร็วผิดปกติเกินมนุษย์)
   */
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

    if (interval < Soer.timing.rapidAnswerThresholdMs) {
      this.answerTiming.rapidAnswers++;
      this._addViolation('Rapid Answer', Soer.points.rapidAnswer, 'answerTiming', `ตอบห่างกัน ${Math.round(interval)} ms`);
    }
    this.lastAnswerAt = now;
  }

  /**
   * เก็บข้อมูลการเคลื่อนที่ของเมาส์ ใช้ยืนยันว่าเป็นคนใช้งานจริงหรือไม่
   */
  _analyzeMouseMove(e) {
    const now = Date.now();
    if (now - this.mouseStats.lastMoveAt < Soer.timing.mouseMoveThrottleMs) return;
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

  /**
   * ป้องกันการเขียนข้อมูลข้าม API ขัดขวางการแก้คะแนนหรือสคริปต์แก้ไขข้อสอบ
   */
  _guardStorageApis() {
    const originalSetItem = Storage.prototype.setItem;
    const self = this;
    Storage.prototype.setItem = function(key, value) {
      if (!window.__mattepSubmitting && (key === 'mattepExamRecords' || key === 'examSubmission')) {
        self._addViolation('Storage Write', Soer.points.storageWrite, 'storage', `เขียนข้อมูล ${key}`);
      }
      return originalSetItem.apply(this, arguments);
    };
  }

  /**
   * ตรวจจับหน้าต่าง DevTools ที่เปิดแบบ Docking (ดูจากการลดลงของพื้นที่หน้าจอ)
   */
  _monitorDevtoolsResize() {
    setInterval(() => {
      const widthGap = Math.abs(window.outerWidth - window.innerWidth);
      const heightGap = Math.abs(window.outerHeight - window.innerHeight);
      if ((widthGap > Soer.limits.devtoolsWidthGap || heightGap > Soer.limits.devtoolsHeightGap) && !this._isRecent('devtools-resize', Soer.timing.devtoolsResizeCooldownMs)) {
        this._addViolation('Possible DevTools', Soer.points.possibleDevtools, 'devtools', 'ขนาดหน้าต่างคล้ายเปิดเครื่องมือนักพัฒนา');
      }
    }, Soer.timing.devtoolsResizeCheckIntervalMs);
  }

  /**
   * ลูปวิเคราะห์รูปแบบการพิมพ์ (Typing Pattern) อย่างต่อเนื่อง
   */
  _startPatternLoop() {
    setInterval(() => {
      const intervals = this.typingStats.intervals.slice(-Soer.limits.typingIntervalSlice);
      if (intervals.length >= Soer.limits.typingIntervalMinLength) {
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avg < Soer.limits.typingAvgSpeedFast && !this._isRecent('typing-pattern', Soer.timing.typingPatternCooldownMs)) {
          this.typingStats.fastBursts++;
          this._addViolation('Fast Typing Pattern', Soer.points.fastTypingPattern, 'typing', 'ความเร็วพิมพ์สม่ำเสมอผิดปกติ');
        }
      }
    }, Soer.timing.typingPatternCheckIntervalMs);
  }

  /**
   * แสดงหน้าจอสีดำบังข้อสอบชั่วคราว เมื่อมีการกดแคปหน้าจอ (รบกวนการถ่ายภาพ)
   */
  _blackout(duration) {
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;background:#020617;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font:700 18px sans-serif;z-index:9999;padding:24px;';
    cover.textContent = 'ระบบป้องกันการแคปหน้าจอทำงาน กรุณากลับมาทำข้อสอบต่อ';
    document.body.appendChild(cover);
    setTimeout(() => cover.remove(), duration);
  }

  /**
   * แสดงสถานะว่า Anti-Cheat ทำงานอยู่
   */
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

  /**
   * บันทึกความผิด เพิ่มคะแนนสะสม และยิง Event แจ้งเตือนไปยังระบบหลัก
   */
  _addViolation(type, points, category, details = '', image = null) {
    if (this._isRecent(`${type}:${details}`, Soer.timing.violationCooldownMs)) return;
    this.eventCounts[category] = (this.eventCounts[category] || 0) + 1;
    this.suspicionScore = Math.min(100, this.suspicionScore + points);

    const event = {
      type,
      category,
      details,
      image,
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

  // เพิ่ม Public Method ให้ระบบ AI ของกล้องนำข้อมูลมาบันทึกลงใน Event Log
  addViolation({ description, points, category, details = '', image = null }) {
    this._addViolation(description, points, category, details, image);
  }

  /**
   * แปลงประเภทความผิดเป็นคำอธิบายภาษาไทย เพื่อแสดงในรายงาน
   */
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

  /**
   * ประเมินระดับความเสี่ยงจากคะแนนสะสม
   */
  _riskLevel() {
    if (this.suspicionScore >= this.thresholds.cheating) return 'CHEATING';
    if (this.suspicionScore >= this.thresholds.highRisk) return 'HIGH RISK';
    if (this.suspicionScore >= this.thresholds.warning) return 'WARNING';
    return 'SAFE';
  }

  /**
   * สรุปรายงานการวิเคราะห์ (ดึงไปใช้ตอนส่งข้อสอบ)
   */
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
