/**
 * MATTEP Anti-Cheat System v2.0
 * Production-Ready Behavioral Monitoring System
 * Integrated with Online Exam Platform
 */

class AntiCheat {
  constructor() {
    // Core State
    this.suspicionScore = 0;
    this.violations = [];
    this.timeline = [];
    this.lastAlertTime = 0;
    this.studentId = null;
    this.examStartTime = Date.now();

    // Debounce/Throttle
    this.alertDebounce = 2000; // Min 2s between alerts
    this.lastEventTime = {};

    // Tracking State
    this.tabInactiveStart = null;
    this.lastPasteTime = 0;
    this.screenshotDetected = false;
    this.fullscreenActive = true;
    this.keyPressLog = [];
    this.lastInputLength = {};
    this.lastInputTime = {};

    // Counters
    this.eventCounts = {
      devtools: 0,
      tabSwitch: 0,
      paste: 0,
      copy: 0,
      cut: 0,
      rightClick: 0,
      screenshot: 0,
      fastAnswer: 0,
      suspiciousKeyboard: 0,
    };

    // Risk Thresholds
    this.thresholds = { warning: 40, highRisk: 60, cheating: 80 };
    this.alertedLevels = new Set(); // Track which alerts we've shown

    this.init();
  }

  /**
   * Initialize Anti-Cheat System
   */
  init() {
    console.log('[AntiCheat] Initializing system...');

    this.setupEventListeners();
    this.startMonitoring();
    this.detectStudentInfo();

    console.log('[AntiCheat] System initialized successfully');
  }

  /**
   * Setup Event Listeners
   */
  setupEventListeners() {
    // 1. DevTools Detection
    document.addEventListener('keydown', (e) => this.detectDevTools(e), true);

    // 2. Tab/Focus Detection
    document.addEventListener('visibilitychange', () => this.detectTabSwitch());
    window.addEventListener('blur', () => this.detectWindowBlur());
    window.addEventListener('focus', () => this.detectWindowFocus());

    // 3. Copy/Paste/Cut Detection
    document.addEventListener('copy', (e) => this.detectCopy(e), true);
    document.addEventListener('paste', (e) => this.detectPaste(e), true);
    document.addEventListener('cut', (e) => this.detectCut(e), true);

    // 4. Right Click Detection
    document.addEventListener('contextmenu', (e) => this.detectRightClick(e), true);

    // 5. Selection/Drag Detection
    document.addEventListener('selectstart', (e) => this.detectSelection(e));
    document.addEventListener('dragstart', (e) => this.detectSelection(e));

    // 6. Screenshot Detection
    document.addEventListener('keydown', (e) => this.detectScreenshot(e), true);

    // 7. Fullscreen Detection
    document.addEventListener('fullscreenchange', () => this.detectFullscreenExit());
    document.addEventListener('webkitfullscreenchange', () => this.detectFullscreenExit());

    // 8. Keyboard Input Monitoring
    document.addEventListener('keydown', (e) => this.monitorKeyboard(e));
    document.addEventListener('input', (e) => this.analyzeInput(e));

    console.log('[AntiCheat] Event listeners setup complete');
  }

  /**
   * 1. DevTools Detection
   */
  detectDevTools(e) {
    const isSuspicious =
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && e.key === 'I') || // Ctrl+Shift+I
      (e.ctrlKey && e.shiftKey && e.key === 'J') || // Ctrl+Shift+J
      (e.ctrlKey && e.key === 'U'); // Ctrl+U

    if (isSuspicious) {
      e.preventDefault();
      this.addViolation('DevTools Access', 30, 'devtools', `Method: ${e.key}`);
    }
  }

  /**
   * 2. Tab Switch Detection
   */
  detectTabSwitch() {
    if (document.hidden) {
      // Tab became hidden
      this.tabInactiveStart = Date.now();
      this.addViolation('Tab Hidden', 0, 'tabSwitch', 'User left exam tab');
    } else {
      // Tab became visible
      if (this.tabInactiveStart) {
        const inactiveDuration = (Date.now() - this.tabInactiveStart) / 1000;
        let points = 0;

        if (inactiveDuration >= 20) points = 20;
        else if (inactiveDuration >= 10) points = 15;
        else if (inactiveDuration >= 5) points = 10;
        else if (inactiveDuration >= 3) points = 6;
        else points = 2;

        this.addViolation(
          `Tab Switch - ${inactiveDuration.toFixed(1)}s`,
          points,
          'tabSwitch',
          `Away for ${inactiveDuration.toFixed(1)} seconds`
        );

        this.tabInactiveStart = null;
      }
    }
  }

  detectWindowBlur() {
    this.tabInactiveStart = Date.now();
    this.addViolation('Window Blur', 0, 'tabSwitch', 'Window lost focus');
  }

  detectWindowFocus() {
    if (this.tabInactiveStart) {
      const inactiveDuration = (Date.now() - this.tabInactiveStart) / 1000;
      if (inactiveDuration >= 3) {
        let points = inactiveDuration >= 20 ? 20 : inactiveDuration >= 10 ? 15 : 10;
        this.addViolation(
          `Window Focus Return - ${inactiveDuration.toFixed(1)}s`,
          points,
          'tabSwitch',
          `Window was unfocused for ${inactiveDuration.toFixed(1)}s`
        );
      }
      this.tabInactiveStart = null;
    }
  }

  /**
   * 3. Copy Detection
   */
  detectCopy(e) {
    const selectedText = window.getSelection().toString();
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const points = 10;
    this.addViolation('Copy Detected', points, 'copy', `${selectedText.length} characters`);
    return false;
  }

  /**
   * 4. Paste Detection
   */
  detectPaste(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    let pastedText = '';
    if (e.clipboardData || window.clipboardData) {
      pastedText = (e.originalEvent || e).clipboardData.getData('text/plain');
    }

    const length = pastedText.length;
    let points = 20; // Base points

    // Add points based on length
    if (length > 300) points += 15;
    else if (length > 100) points += 10;

    // Check for suspicious patterns
    const suspiciousPatterns = ['http', 'https', 'function', 'const', 'class', 'import', 'chatgpt', 'ai'];
    const hasSuspiciousPattern = suspiciousPatterns.some((pattern) =>
      pastedText.toLowerCase().includes(pattern)
    );

    if (hasSuspiciousPattern) {
      points += 10;
    }

    this.addViolation(
      'Paste Detected',
      Math.min(points, 50),
      'paste',
      `${length} chars${hasSuspiciousPattern ? ' [SUSPICIOUS]' : ''}`
    );

    // Check for paste + fast submit pattern (will be analyzed in patternAnalysis)
    this.lastPasteTime = Date.now();
    return false;
  }

  /**
   * 5. Cut Detection
   */
  detectCut(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this.addViolation('Cut Operation', 10, 'cut', 'User attempted cut');
    return false;
  }

  /**
   * 6. Right Click Detection
   */
  detectRightClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this.addViolation('Right Click', 5, 'rightClick', 'Context menu attempt');
    return false;
  }

  /**
   * 7. Selection/Drag Detection
   */
  detectSelection(e) {
    if (e.type === 'selectstart' && !this.isEventRecent('selectstart')) {
      e.preventDefault();
      e.stopPropagation();
      this.addViolation('Text Selection', 5, 'rightClick', 'User selected text');
      this.lastEventTime['selectstart'] = Date.now();
      return false;
    }
  }

  /**
   * 8. Screenshot Detection
   */
  detectScreenshot(e) {
    const isScreenshotKey =
      e.key === 'PrintScreen' ||
      (e.shiftKey && e.key === 's' && e.ctrlKey) || // Ctrl+Shift+S
      (e.key === 'PrintScreen');

    if (isScreenshotKey) {
      e.preventDefault();
      this.addViolation('Screenshot Attempt', 20, 'screenshot', 'PrintScreen or Win+Shift+S');

      // Show black overlay for 5 seconds
      this.showScreenBlackout(5000);
    }
  }

  showScreenBlackout(duration = 5000) {
    if (this.screenshotDetected) return; // Prevent multiple overlays

    this.screenshotDetected = true;

    const overlay = document.createElement('div');
    overlay.id = 'antiCheatBlackout';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #000;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 24px;
      font-weight: bold;
      font-family: Arial, sans-serif;
    `;
    overlay.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
        <div>Screenshot Detected!</div>
        <div style="font-size: 16px; margin-top: 20px; color: #999;">This exam is being protected</div>
      </div>
    `;

    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
      this.screenshotDetected = false;
    }, duration);
  }

  /**
   * 9. Fullscreen Exit Detection
   */
  detectFullscreenExit() {
    if (!document.fullscreenElement && this.fullscreenActive) {
      this.addViolation('Fullscreen Exit', 10, 'tabSwitch', 'User exited fullscreen');
      this.fullscreenActive = false;
    }
  }

  /**
   * 10. Keyboard Monitoring
   */
  monitorKeyboard(e) {
    // Block Ctrl+C (Copy)
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.addViolation('Keyboard Copy (Ctrl+C)', 10, 'copy', 'Attempted Ctrl+C');
      return false;
    }

    // Block Ctrl+V (Paste)
    if (e.ctrlKey && e.key.toLowerCase() === 'v' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.addViolation('Keyboard Paste (Ctrl+V)', 20, 'paste', 'Attempted Ctrl+V');
      return false;
    }

    // Block Ctrl+X (Cut)
    if (e.ctrlKey && e.key.toLowerCase() === 'x' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.addViolation('Keyboard Cut (Ctrl+X)', 10, 'cut', 'Attempted Ctrl+X');
      return false;
    }

    // Detect suspicious shortcuts
    const suspiciousShortcuts = [
      { ctrlKey: true, key: 'a' }, // Ctrl+A
      { ctrlKey: true, key: 's' }, // Ctrl+S (but not Ctrl+Shift+S)
      { ctrlKey: true, key: 'p' }, // Ctrl+P
    ];

    for (const shortcut of suspiciousShortcuts) {
      if (
        e.ctrlKey === shortcut.ctrlKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === shortcut.key
      ) {
        e.preventDefault();
        this.addViolation('Suspicious Shortcut', 10, 'suspiciousKeyboard', `Ctrl+${shortcut.key.toUpperCase()}`);
      }
    }

    this.keyPressLog.push(Date.now());

    // Keep only recent presses
    if (this.keyPressLog.length > 100) {
      this.keyPressLog.shift();
    }
  }

  /**
   * 11. Input Analysis (Fast Answer Detection)
   */
  analyzeInput(e) {
    const target = e.target;
    if (!target) return;

    const questionCard = target.closest('.question-card');
    if (!questionCard) return;

    const currentLength = target.value?.length || 0;
    const questionId = questionCard.getAttribute('data-question-id') || 'unknown';

    // Track input length change
    const previousLength = this.lastInputLength[questionId] || 0;
    const lastTime = this.lastInputTime[questionId] || 0;
    const currentTime = Date.now();

    // If large jump in length with short time gap = potential paste/autofill
    if (currentLength > previousLength + 50 && currentTime - lastTime < 500) {
      this.addViolation(
        'Suspicious Input Pattern',
        15,
        'suspiciousKeyboard',
        `Large input jump: +${currentLength - previousLength} chars in 500ms`
      );
    }

    // Fast answer detection (essay)
    if (target.tagName === 'TEXTAREA' && currentLength > 200) {
      const timeSinceStart = currentTime - (this.lastInputTime[questionId] || currentTime - 60000);
      if (timeSinceStart < 3000) {
        this.addViolation(
          'Very Fast Essay Answer',
          20,
          'fastAnswer',
          `${currentLength} chars in ${(timeSinceStart / 1000).toFixed(1)}s`
        );
      }
    }

    this.lastInputLength[questionId] = currentLength;
    this.lastInputTime[questionId] = currentTime;
  }

  /**
   * Start Continuous Monitoring
   */
  startMonitoring() {
    // Detect browser resize (DevTools indicator)
    let originalWidth = window.outerWidth;
    let originalHeight = window.outerHeight;

    window.addEventListener('resize', () => {
      const widthDiff = Math.abs(window.outerWidth - originalWidth);
      const heightDiff = Math.abs(window.outerHeight - originalHeight);

      if (widthDiff > 150 || heightDiff > 150) {
        if (!this.isEventRecent('resize')) {
          this.addViolation('Window Resize', 5, 'devtools', `DevTools possibly opened`);
          this.lastEventTime['resize'] = Date.now();
        }
      }
    });

    // Pattern analysis loop
    setInterval(() => this.patternAnalysis(), 15000); // Every 15 seconds
  }

  /**
   * Pattern Analysis - Detect Multiple Suspicious Events
   */
  patternAnalysis() {
    const recentViolations = this.violations.slice(-10);

    // Pattern 1: Tab Switch + Paste + Fast Submit
    const hasTabSwitch = recentViolations.some((v) => v.category === 'tabSwitch');
    const hasPaste = recentViolations.some((v) => v.category === 'paste');

    if (hasTabSwitch && hasPaste && this.lastPasteTime) {
      const timeSincePaste = Date.now() - this.lastPasteTime;
      if (timeSincePaste < 5000) {
        // Paste within 5 seconds of tab switch
        this.addViolation(
          'PATTERN: Tab Switch + Paste (Suspicious)',
          35,
          'pattern',
          'Rapid cheating pattern detected'
        );
      }
    }

    // Pattern 2: Multiple events in short time
    const violationsIn15s = this.violations.filter((v) => Date.now() - v.timestamp < 15000).length;

    if (violationsIn15s > 5) {
      this.addViolation(
        'PATTERN: Multiple Violations',
        35,
        'pattern',
        `${violationsIn15s} violations in 15 seconds`
      );
    } else if (violationsIn15s > 3) {
      this.addViolation(
        'PATTERN: Frequent Suspicious Activity',
        20,
        'pattern',
        `${violationsIn15s} violations detected`
      );
    }
  }

  /**
   * Detect Student Information
   */
  detectStudentInfo() {
    const nameField = document.getElementById('studentName');
    if (nameField) {
      this.studentId = nameField.value || 'Unknown';
    }
  }

  /**
   * Check if event is recent (debounce)
   */
  isEventRecent(eventType) {
    const lastTime = this.lastEventTime[eventType] || 0;
    return Date.now() - lastTime < 1000;
  }

  /**
   * Add Violation
   */
  addViolation(description, points = 10, category = 'misc', details = '') {
    // Prevent duplicate violations
    const recentSame = this.violations.filter(
      (v) => v.description === description && Date.now() - v.timestamp < 5000
    ).length;

    if (recentSame > 0) return;

    const violation = {
      id: this.violations.length + 1,
      description,
      points,
      category,
      details,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString('th-TH'),
    };

    this.violations.push(violation);
    this.timeline.push(`[${violation.time}] ${description} (+${points})`);

    // Update score
    this.suspicionScore += points;

    // Increment counter
    if (this.eventCounts[category]) {
      this.eventCounts[category]++;
    }

    console.log(`[AntiCheat] ${description} +${points} (Total: ${this.suspicionScore})`);

    // Check risk level and trigger actions
    this.checkRiskLevel();

    return violation;
  }

  /**
   * Check Risk Level and Trigger Actions
   */
  checkRiskLevel() {
    const score = this.suspicionScore;
    const now = Date.now();

    // Only alert once per threshold, and with debounce
    if (score >= this.thresholds.cheating) {
      if (!this.alertedLevels.has('cheating') && now - this.lastAlertTime > this.alertDebounce) {
        this.showAlert(
          '⛔ ตรวจพบพฤติกรรมเข้าข่ายทุจริตรุนแรง\nระบบส่งข้อสอบอัตโนมัติ',
          'CHEATING'
        );
        this.alertedLevels.add('cheating');
        this.lastAlertTime = now;
        this.lockExamAndSubmit();
      }
    } else if (score >= this.thresholds.highRisk) {
      if (!this.alertedLevels.has('highRisk') && now - this.lastAlertTime > this.alertDebounce) {
        this.showAlert(
          '🚨 คะแนนความเสี่ยงสูง\nข้อมูลการทำข้อสอบของคุณกำลังถูกติดตาม',
          'HIGH_RISK'
        );
        this.alertedLevels.add('highRisk');
        this.lastAlertTime = now;

        // Disable clipboard
        this.disableClipboard();
      }
    } else if (score >= this.thresholds.warning) {
      if (!this.alertedLevels.has('warning') && now - this.lastAlertTime > this.alertDebounce) {
        this.showAlert(
          '⚠️ ตรวจพบพฤติกรรมผิดปกติ\nระบบกำลังติดตามการสอบของคุณ',
          'WARNING'
        );
        this.alertedLevels.add('warning');
        this.lastAlertTime = now;
      }
    }
  }

  /**
   * Show Alert
   */
  showAlert(message, level) {
    const overlay = document.createElement('div');
    overlay.className = 'antiCheat-alert-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
    `;

    const alertBox = document.createElement('div');
    const bgColor = level === 'CHEATING' ? '#dc2626' : level === 'HIGH_RISK' ? '#ea580c' : '#f59e0b';
    const textColor = '#ffffff';

    alertBox.style.cssText = `
      background: ${bgColor};
      color: ${textColor};
      padding: 40px;
      border-radius: 20px;
      text-align: center;
      max-width: 500px;
      font-size: 18px;
      font-weight: bold;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      line-height: 1.6;
      word-break: break-word;
    `;
    alertBox.innerText = message;

    overlay.appendChild(alertBox);
    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
    }, 5000);
  }

  /**
   * Disable Clipboard Functions
   */
  disableClipboard() {
    // Disable copy
    document.oncopy = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // Disable paste
    document.onpaste = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // Disable cut
    document.oncut = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // Disable right-click
    document.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // Also disable drag and drop
    document.ondrag = (e) => {
      e.preventDefault();
      return false;
    };

    document.ondrop = (e) => {
      e.preventDefault();
      return false;
    };

    console.log('[AntiCheat] Clipboard disabled at risk level HIGH RISK');
  }

  /**
   * Lock Exam and Submit Automatically
   */
  lockExamAndSubmit() {
    // Disable all form inputs
    document.querySelectorAll('input, textarea').forEach((el) => {
      el.disabled = true;
    });

    // Call submit if it exists
    if (typeof submitExam === 'function') {
      setTimeout(() => submitExam(), 2000);
    }
  }

  /**
   * Get Current Risk Level
   */
  getRiskLevel() {
    const score = this.suspicionScore;
    if (score >= this.thresholds.cheating) return 'CHEATING';
    if (score >= this.thresholds.highRisk) return 'HIGH RISK';
    if (score >= this.thresholds.warning) return 'WARNING';
    return 'SAFE';
  }

  /**
   * Get Risk Color
   */
  getRiskColor() {
    const level = this.getRiskLevel();
    const colors = {
      SAFE: '#10b981',
      WARNING: '#f59e0b',
      'HIGH RISK': '#ef4444',
      CHEATING: '#dc2626',
    };
    return colors[level] || '#6b7280';
  }

  /**
   * Get Analysis Report
   */
  getAnalysisReport() {
    const runtime = Math.floor((Date.now() - this.examStartTime) / 1000);
    const minutes = Math.floor(runtime / 60);
    const seconds = runtime % 60;

    return {
      studentId: this.studentId,
      suspicionScore: this.suspicionScore,
      riskLevel: this.getRiskLevel(),
      riskColor: this.getRiskColor(),
      runtime: `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`,
      violations: this.violations,
      timeline: this.timeline,
      statistics: this.eventCounts,
      violationCount: this.violations.length,
      timestamp: new Date().toLocaleString('th-TH'),
    };
  }

  /**
   * Export Data
   */
  exportData() {
    return JSON.stringify(this.getAnalysisReport(), null, 2);
  }

  /**
   * Destroy System
   */
  destroy() {
    console.log('[AntiCheat] Destroying system...');
    this.violations = [];
    this.timeline = [];
    this.suspicionScore = 0;
    this.eventCounts = {};
  }
}

// Global instance
let antiCheat = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    antiCheat = new AntiCheat();
  });
} else {
  antiCheat = new AntiCheat();
  // Configuration
  config: {
    minTypingInterval: 10,      // Minimum ms between keystrokes (suspicious if less)
    maxTypingInterval: 2000,    // Maximum ms between keystrokes (suspicious if more)
    devtoolsCheckInterval: 100, // Check for devtools every 100ms
    fastAnswerThreshold: 3000,  // Answer submitted in less than 3 seconds
    duplicateWindowMs: 120000,  // Apply damping for duplicated events within 2 minutes
    // Weighted scoring model (sum of weights = 1.0)
    riskWeights: {
      focus: 0.18,
      paste: 0.15,
      devtools: 0.22,
      timing: 0.14,
      typing: 0.12,
      pattern: 0.14,
      mouse: 0.03,
      misc: 0.02,
    },
    // Raw-risk cap per category before weight is considered saturated
    riskCaps: {
      focus: 0.9,
      paste: 0.8,
      devtools: 0.7,
      timing: 0.9,
      typing: 0.8,
      pattern: 0.7,
      mouse: 0.5,
      misc: 0.4,
    },
    severityMultiplier: {
      info: 0.85,
      warning: 1.0,
      critical: 1.25,
    },
    questionTypeMultiplier: {
      none: 0.95,
      objective: 1.08,
      essay: 1.15,
    },
    maxSingleEventRisk: 0.45,
    repetitionGrowthStep: 0.04,
    repetitionGrowthCap: 1.35,
  },

  // State variables
  state: {
    studentId: null,
    isActive: true,
    startTime: Date.now(),
    suspicionScore: 0,
    violations: [],
    timeline: [],
    lastEventTime: Date.now(),
    keyPressTimings: [],
    answerStartTimes: {},
    mouseIdleTime: 0,
    mouseLastMoveTime: Date.now(),
    totalTabSwitches: 0,
    totalPastes: 0,
    totalDevtoolsDetections: 0,
    devtoolsOpen: false,
    tabInactiveStart: null,
    answeredQuestions: {},
    categoryRawRisk: {
      focus: 0,
      paste: 0,
      devtools: 0,
      timing: 0,
      typing: 0,
      pattern: 0,
      mouse: 0,
      misc: 0,
    },
    categoryEventCounts: {
      focus: 0,
      paste: 0,
      devtools: 0,
      timing: 0,
      typing: 0,
      pattern: 0,
      mouse: 0,
      misc: 0,
    },
  },

  // Initialize the system
  init() {
    this.setupEventListeners();
    this.startDevtoolsDetection();
    this.startMouseTracking();
    this.startAnswerTracking();
    console.log('[AntiCheat] System initialized');
  },

  setStudentId(id) {
    this.state.studentId = id;
  },

  // 1. TAB SWITCHING DETECTION
  setupEventListeners() {
    // Visibility API - detect when tab loses focus
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.logTabSwitch('hidden');
      } else {
        this.logTabSwitch('active');
      }
    });

    // Focus/Blur events
    window.addEventListener('blur', () => {
      this.logTabSwitch('blur');
    });

    window.addEventListener('focus', () => {
      this.logTabSwitch('focus');
    });

    // 2. COPY/PASTE DETECTION
    document.addEventListener('copy', (e) => {
      this.logCopyAction(e);
    });

    document.addEventListener('paste', (e) => {
      this.logPasteAction(e);
    });

    // 3. TYPING PATTERN ANALYSIS
    document.addEventListener('keydown', (e) => {
      this.trackKeyPress(e);
    });

    // Prevent common cheating shortcuts
    document.addEventListener('keydown', (e) => {
      // Block F12 (DevTools)
      if (e.key === 'F12') {
        e.preventDefault();
        this.logDevtoolsAttempt('F12');
      }
      // Block Ctrl+Shift+I (Inspect)
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        this.logDevtoolsAttempt('Ctrl+Shift+I');
      }
      // Block Ctrl+Shift+C (Inspect Element)
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        this.logDevtoolsAttempt('Ctrl+Shift+C');
      }
      // Block Right Click context menu (optional)
      if (e.button === 2) {
        // Allow right click but log it
        this.addViolation('Right-click Context Menu', 'info', 0.03, 'misc');
      }
    });

    // Disable right-click context menu on exam area
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.question-card') || e.target.closest('textarea') || e.target.closest('input[type="radio"]')) {
        e.preventDefault();
        this.addViolation('Context Menu Blocked', 'warning', 0.08, 'misc');
      }
    });
  },

  // Tab Switching
  logTabSwitch(status) {
    const timestamp = new Date().toLocaleTimeString('th-TH');
    const now = Date.now();
    const event = {
      type: 'tab_switch',
      status: status,
      time: timestamp,
      timestamp: now,
    };

    this.timeline.push(event);

    const leavingContext = (status === 'hidden' || status === 'blur');
    if (leavingContext) {
      if (!this.state.tabInactiveStart) {
        this.state.tabInactiveStart = now;
      }
      return;
    }

    const returningContext = (status === 'active' || status === 'focus');
    if (returningContext && this.state.tabInactiveStart) {
      const inactiveDurationMs = now - this.state.tabInactiveStart;
      this.state.tabInactiveStart = null;
      this.state.totalTabSwitches++;

      const inactiveSeconds = (inactiveDurationMs / 1000).toFixed(1);
      let baseRisk = 0.05;
      let severity = 'info';

      if (inactiveDurationMs >= 20000) {
        baseRisk = 0.2;
        severity = 'warning';
      } else if (inactiveDurationMs >= 10000) {
        baseRisk = 0.14;
        severity = 'warning';
      } else if (inactiveDurationMs >= 4000) {
        baseRisk = 0.09;
      }

      this.addViolation(
        `Tab Switch: Away for ${inactiveSeconds}s`,
        severity,
        baseRisk,
        'focus',
        { inactiveDurationMs: inactiveDurationMs, eventKind: 'tab_switch' }
      );
    }

    console.log('[AntiCheat] Tab Switch:', event);
  },

  // 2. Copy/Paste Detection
  logCopyAction(e) {
    const selectedText = window.getSelection().toString();
    const timestamp = new Date().toLocaleTimeString('th-TH');
    const event = {
      type: 'copy',
      length: selectedText.length,
      time: timestamp,
      timestamp: Date.now(),
    };

    this.timeline.push(event);
    this.addViolation(
      `Copy Detected (${selectedText.length} characters)`,
      'info',
      0.04,
      'misc'
    );

    console.log('[AntiCheat] Copy detected:', event);
  },

  logPasteAction(e) {
    // Get clipboard data
    let pastedText = '';
    if (e.clipboardData || window.clipboardData) {
      pastedText = (e.originalEvent || e).clipboardData.getData('text/plain');
    }

    const timestamp = new Date().toLocaleTimeString('th-TH');
    const event = {
      type: 'paste',
      length: pastedText.length,
      time: timestamp,
      timestamp: Date.now(),
    };

    this.timeline.push(event);
    this.state.totalPastes++;

    const pasteWeight = Math.min(0.22, 0.1 + Math.min(pastedText.length, 500) / 5000);
    const hasUrlLikeText = /https?:\/\/|www\./i.test(pastedText);
    const hasCodeLikeText = /\b(function|const|let|var|class|SELECT|INSERT|UPDATE|DELETE)\b|<\w+[^>]*>/i.test(pastedText);
    this.addViolation(
      `Paste Detected (${pastedText.length} characters)`,
      'warning',
      Number(pasteWeight.toFixed(3)),
      'paste',
      {
        pastedLength: pastedText.length,
        hasUrlLikeText: hasUrlLikeText,
        hasCodeLikeText: hasCodeLikeText,
        eventKind: 'paste',
      }
    );

    // Check for suspicious patterns
    this.analyzePatterns();

    console.log('[AntiCheat] Paste detected:', event);
  },

  // 3. DevTools Detection
  startDevtoolsDetection() {
    // Detect DevTools opening via console
    let lastCheck = new Date();
    setInterval(() => {
      let startTime = performance.now();
      console.log('');
      let endTime = performance.now();

      if (endTime - startTime > 100) {
        if (!this.state.devtoolsOpen) {
          this.state.devtoolsOpen = true;
          this.logDevtoolsAttempt('DevTools Detected');
        }
      } else {
        this.state.devtoolsOpen = false;
      }
    }, this.config.devtoolsCheckInterval);

    // Detect viewport resize (common with DevTools)
    let originalWidth = window.outerWidth;
    let originalHeight = window.outerHeight;

    window.addEventListener('resize', () => {
      const widthDiff = Math.abs(window.outerWidth - originalWidth);
      const heightDiff = Math.abs(window.outerHeight - originalHeight);

      if (widthDiff > 100 || heightDiff > 100) {
        this.addViolation(
          `Viewport Size Changed (W: ${widthDiff}px, H: ${heightDiff}px)`,
          'warning',
          0.07,
          'devtools'
        );
      }
    });
  },

  logDevtoolsAttempt(method) {
    const timestamp = new Date().toLocaleTimeString('th-TH');
    const event = {
      type: 'devtools',
      method: method,
      time: timestamp,
      timestamp: Date.now(),
    };

    this.timeline.push(event);
    this.state.totalDevtoolsDetections++;

    this.addViolation(
      `DevTools Attempt: ${method}`,
      'critical',
      0.25,
      'devtools'
    );

    console.log('[AntiCheat] DevTools detection:', event);
  },

  // 4. TYPING PATTERN ANALYSIS
  trackKeyPress(e) {
    const currentTime = Date.now();
    const textarea = document.querySelector('textarea:focus');
    const radioInput = document.querySelector('input[type="radio"]:focus');

    if (!textarea && !radioInput) return;

    // Track typing speed
    if (this.state.keyPressTimings.length > 0) {
      const lastKeyTime = this.state.keyPressTimings[this.state.keyPressTimings.length - 1];
      const interval = currentTime - lastKeyTime;

      // Detect paste via very fast key entry
      if (interval < this.config.minTypingInterval) {
        this.addViolation(
          `Rapid Key Entry (${interval}ms interval)`,
          'warning',
          0.08,
          'typing'
        );
      }

      // Detect suspiciously fast answer
      if (interval > this.config.maxTypingInterval) {
        this.addViolation(
          `Long Idle Typing Time (${interval}ms)`,
          'info',
          0.03,
          'typing'
        );
      }
    }

    this.state.keyPressTimings.push(currentTime);

    // Keep only last 100 key presses
    if (this.state.keyPressTimings.length > 100) {
      this.state.keyPressTimings.shift();
    }
  },

  getTypingAnalysis() {
    if (this.state.keyPressTimings.length < 2) {
      return { status: 'Insufficient Data' };
    }

    const intervals = [];
    for (let i = 1; i < this.state.keyPressTimings.length; i++) {
      intervals.push(this.state.keyPressTimings[i] - this.state.keyPressTimings[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);

    return {
      averageInterval: avgInterval.toFixed(2) + 'ms',
      minInterval: minInterval + 'ms',
      maxInterval: maxInterval + 'ms',
      keyPresses: this.state.keyPressTimings.length,
    };
  },

  // 5. MOUSE MOVEMENT ANALYSIS
  startMouseTracking() {
    let mouseIdleTimer;

    document.addEventListener('mousemove', () => {
      this.state.mouseLastMoveTime = Date.now();
      clearTimeout(mouseIdleTimer);

      // Check if mouse movement is too uniform (automated)
      this.state.mouseIdleTime = 0;

      mouseIdleTimer = setTimeout(() => {
        this.state.mouseIdleTime += 5;
        if (this.state.mouseIdleTime > 30) {
          this.addViolation(
            `Mouse Idle: ${this.state.mouseIdleTime} seconds`,
            'info',
            0.05,
            'mouse'
          );
        }
      }, 5000);
    });

    document.addEventListener('click', () => {
      this.state.mouseIdleTime = 0;
    });
  },

  // 6. ANSWER TIMING ANALYSIS
  startAnswerTracking() {
    // Track when user starts answering a question
    document.addEventListener('click', (e) => {
      const questionCard = e.target.closest('.question-card');
      if (questionCard) {
        const questionNum = questionCard.querySelector('.question-number');
        if (questionNum) {
          const qNum = questionNum.textContent.trim();
          if (!this.state.answerStartTimes[qNum]) {
            this.state.answerStartTimes[qNum] = Date.now();
          }
        }
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target.type === 'radio') {
        this.markQuestionAnswered(e.target);
        this.analyzeAnswerTiming(e.target);
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.tagName === 'TEXTAREA') {
        this.markQuestionAnswered(e.target);
        this.analyzeAnswerTiming(e.target);
      }
    });
  },

  markQuestionAnswered(element) {
    const questionCard = element.closest('.question-card');
    if (!questionCard) return;

    const questionNum = questionCard.querySelector('.question-number');
    if (!questionNum) return;

    const qNum = questionNum.textContent.trim();
    this.state.answeredQuestions[qNum] = true;
  },

  analyzeAnswerTiming(element) {
    const questionCard = element.closest('.question-card');
    if (!questionCard) return;

    const questionNum = questionCard.querySelector('.question-number');
    if (!questionNum) return;

    const qNum = questionNum.textContent.trim();
    const startTime = this.state.answerStartTimes[qNum];

    if (startTime) {
      const timeTaken = Date.now() - startTime;

      if (timeTaken < this.config.fastAnswerThreshold) {
        const speedRatio = 1 - (timeTaken / this.config.fastAnswerThreshold);
        const fastAnswerRisk = 0.1 + Math.max(0, speedRatio) * 0.08; // base +0.1 as requested
        this.addViolation(
          `Question ${qNum}: Answered in ${(timeTaken / 1000).toFixed(2)}s (Very Fast)`,
          'warning',
          Number(fastAnswerRisk.toFixed(3)),
          'timing',
          {
            answerDurationMs: timeTaken,
            answerSpeedRatio: Number(Math.max(0, speedRatio).toFixed(3)),
            eventKind: 'fast_answer',
          }
        );
      }
    }
  },

  // PATTERN ANALYSIS - Risk Engine
  analyzePatterns() {
    // Look for suspicious patterns in timeline
    const recentEvents = this.timeline.slice(-10); // Last 10 events

    // Pattern 1: Tab Switch -> Paste -> Fast Answer
    const hasTabSwitch = recentEvents.some(e => e.type === 'tab_switch' && (e.status === 'hidden' || e.status === 'blur'));
    const hasPaste = recentEvents.some(e => e.type === 'paste');
    const hasDevtools = recentEvents.some(e => e.type === 'devtools');

    if (hasTabSwitch && hasPaste) {
      this.addViolation(
        'Suspicious Pattern: Tab Switch + Paste Detected',
        'critical',
        0.18,
        'pattern',
        { eventKind: 'pattern_mix_focus_paste' }
      );
    }

    if (hasDevtools && hasPaste) {
      this.addViolation(
        'Suspicious Pattern: DevTools + Paste Detected',
        'critical',
        0.22,
        'pattern',
        { eventKind: 'pattern_mix_devtools_paste' }
      );
    }

    if (hasTabSwitch && hasDevtools) {
      this.addViolation(
        'Suspicious Pattern: Tab Switch + DevTools Detected',
        'critical',
        0.20,
        'pattern',
        { eventKind: 'pattern_mix_focus_devtools' }
      );
    }
  },

  getQuestionContextFromElement(element) {
    const target = element && element.nodeType ? element : document.activeElement;
    if (!target || !target.closest) {
      return {
        questionType: 'none',
        questionNo: null,
        isDuringAnswer: false,
      };
    }

    const questionCard = target.closest('.question-card');
    if (!questionCard) {
      return {
        questionType: 'none',
        questionNo: null,
        isDuringAnswer: false,
      };
    }

    const questionNumNode = questionCard.querySelector('.question-number');
    const questionNo = questionNumNode ? questionNumNode.textContent.trim() : null;
    const tagName = String(target.tagName || '').toUpperCase();
    const inputType = String(target.type || '').toLowerCase();

    let questionType = 'none';
    if (tagName === 'TEXTAREA') {
      questionType = 'essay';
    } else if (tagName === 'INPUT' && inputType === 'radio') {
      questionType = 'objective';
    } else if (questionCard.querySelector('textarea')) {
      questionType = 'essay';
    } else if (questionCard.querySelector('input[type="radio"]')) {
      questionType = 'objective';
    }

    return {
      questionType: questionType,
      questionNo: questionNo,
      isDuringAnswer: true,
    };
  },

  getTimerContext() {
    const timerElement = document.getElementById('timerDisplay');
    if (!timerElement) {
      return { remainingSeconds: null, remainingRatio: null };
    }

    const text = String(timerElement.innerText || '');
    const match = text.match(/(\d+):(\d{2})/);
    if (!match) {
      return { remainingSeconds: null, remainingRatio: null };
    }

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return { remainingSeconds: null, remainingRatio: null };
    }

    const remainingSeconds = Math.max(0, (minutes * 60) + seconds);
    const defaultTotalSeconds = 60 * 60;
    return {
      remainingSeconds: remainingSeconds,
      remainingRatio: Math.min(1, remainingSeconds / defaultTotalSeconds),
    };
  },

  getRuntimeContext() {
    const runtimeSeconds = Math.max(0, (Date.now() - this.state.startTime) / 1000);
    return { runtimeSeconds: runtimeSeconds };
  },

  buildAdvantageContext(extra = {}) {
    const sourceElement = extra.sourceElement || document.activeElement;
    const questionContext = this.getQuestionContextFromElement(sourceElement);
    const timerContext = this.getTimerContext();
    const runtimeContext = this.getRuntimeContext();

    const totalQuestions = Math.max(1, document.querySelectorAll('.question-card').length || 10);
    const answeredCount = Object.keys(this.state.answeredQuestions).length;
    const progressRatio = Math.min(1, answeredCount / totalQuestions);

    return {
      ...questionContext,
      ...timerContext,
      ...runtimeContext,
      progressRatio: progressRatio,
      ...extra,
    };
  },

  calculateAdvantageMultiplier(category, severity, baseRisk, context) {
    let multiplier = 1;

    const severityMultiplier = this.config.severityMultiplier[severity] || 1;
    multiplier *= severityMultiplier;

    const questionMultiplier = this.config.questionTypeMultiplier[context.questionType || 'none'] || 1;
    multiplier *= questionMultiplier;

    if (context.isDuringAnswer) {
      multiplier *= 1.06;
    }

    if (category === 'focus') {
      const awayMs = Number(context.inactiveDurationMs || 0);
      if (awayMs >= 20000) {
        multiplier *= 1.35;
      } else if (awayMs >= 10000) {
        multiplier *= 1.22;
      } else if (awayMs >= 4000) {
        multiplier *= 1.1;
      } else if (awayMs > 0 && awayMs < 1500) {
        multiplier *= 0.8;
      }
    }

    if (category === 'paste') {
      const pastedLength = Number(context.pastedLength || 0);
      if (pastedLength >= 200) {
        multiplier *= 1.3;
      } else if (pastedLength >= 80) {
        multiplier *= 1.18;
      } else if (pastedLength >= 20) {
        multiplier *= 1.08;
      } else if (pastedLength > 0 && pastedLength <= 5) {
        multiplier *= 0.75;
      }

      if (context.hasUrlLikeText) multiplier *= 1.12;
      if (context.hasCodeLikeText) multiplier *= 1.1;
    }

    if (category === 'devtools') {
      multiplier *= 1.25;
    }

    if (category === 'timing') {
      const speedRatio = Math.max(0, Number(context.answerSpeedRatio || 0));
      multiplier *= 1 + (speedRatio * 0.35);
      if ((context.questionType === 'objective') && speedRatio >= 0.6) {
        multiplier *= 1.08;
      }
    }

    if (category === 'pattern') {
      multiplier *= 1.2;
    }

    if (context.remainingRatio !== null && context.remainingRatio !== undefined) {
      const r = Number(context.remainingRatio);
      if (['focus', 'paste', 'devtools', 'pattern'].includes(category)) {
        if (r > 0.65) multiplier *= 1.08;
        else if (r < 0.2) multiplier *= 1.05;
      }
    }

    const categoryCount = this.state.categoryEventCounts[category] || 0;
    const repetitionMultiplier = Math.min(
      this.config.repetitionGrowthCap,
      1 + (categoryCount * this.config.repetitionGrowthStep)
    );
    multiplier *= repetitionMultiplier;

    if (baseRisk <= 0.05) {
      multiplier *= 0.92;
    }

    return Number(Math.max(0.35, Math.min(2.5, multiplier)).toFixed(3));
  },

  getDuplicateDamping(description, timestampNow) {
    const recentSameCount = this.state.violations.filter((v) =>
      v.description === description && (timestampNow - v.timestamp) <= this.config.duplicateWindowMs
    ).length;

    return 1 / (1 + (recentSameCount * 0.35));
  },

  recalculateSuspicionScore() {
    let weightedScore = 0;

    Object.keys(this.config.riskWeights).forEach((category) => {
      const weight = this.config.riskWeights[category] || 0;
      const cap = this.config.riskCaps[category] || 1;
      const raw = this.state.categoryRawRisk[category] || 0;
      const normalized = Math.min(raw / cap, 1);
      weightedScore += normalized * weight;
    });

    this.state.suspicionScore = Number((Math.min(100, Math.max(0, weightedScore * 100))).toFixed(1));
  },

  // Add violation event
  addViolation(description, severity = 'warning', riskScore = 0.1, category = 'misc', context = {}) {
    const timestamp = new Date().toLocaleTimeString('th-TH');
    const now = Date.now();
    const baseRiskScore = Math.max(0, Number(riskScore) || 0);
    const scoringContext = this.buildAdvantageContext(context || {});
    const advantageMultiplier = this.calculateAdvantageMultiplier(category, severity, baseRiskScore, scoringContext);
    const duplicateDamping = this.getDuplicateDamping(description, now);
    const adjustedRiskScore = Number(
      Math.min(
        this.config.maxSingleEventRisk,
        baseRiskScore * advantageMultiplier * duplicateDamping
      ).toFixed(3)
    );

    if (adjustedRiskScore <= 0) return;

    const violation = {
      id: this.state.violations.length + 1,
      description: description,
      severity: severity, // 'info', 'warning', 'critical'
      baseRiskScore: Number(baseRiskScore.toFixed(3)),
      advantageMultiplier: advantageMultiplier,
      duplicateDamping: Number(duplicateDamping.toFixed(3)),
      riskScore: adjustedRiskScore,
      category: category,
      time: timestamp,
      timestamp: now,
      context: {
        questionType: scoringContext.questionType,
        questionNo: scoringContext.questionNo,
        isDuringAnswer: scoringContext.isDuringAnswer,
        remainingRatio: scoringContext.remainingRatio,
        progressRatio: scoringContext.progressRatio,
        eventKind: scoringContext.eventKind || null,
      },
    };

    this.state.violations.push(violation);
    if (!Object.prototype.hasOwnProperty.call(this.state.categoryRawRisk, category)) {
      this.state.categoryRawRisk[category] = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(this.state.categoryEventCounts, category)) {
      this.state.categoryEventCounts[category] = 0;
    }
    this.state.categoryRawRisk[category] += adjustedRiskScore;
    this.state.categoryEventCounts[category] += 1;
    this.recalculateSuspicionScore();

    console.log('[AntiCheat] Violation added:', violation);
  },

  // Get violations
  getViolations() {
    return this.state.violations;
  },

  // Get suspicion score
  getSuspicionScore() {
    return Math.min(this.state.suspicionScore, 100);
  },

  // Get risk assessment
  getRiskAssessment() {
    const score = this.getSuspicionScore();
    let level = 'SAFE';
    let color = '#28a745'; // Green

    if (score >= 75) {
      level = 'CRITICAL';
      color = '#dc3545'; // Red
    } else if (score >= 55) {
      level = 'HIGH RISK';
      color = '#fd7e14'; // Orange
    } else if (score >= 35) {
      level = 'MEDIUM RISK';
      color = '#ffc107'; // Yellow
    } else if (score >= 15) {
      level = 'LOW RISK';
      color = '#17a2b8'; // Cyan
    }

    return {
      score: score,
      level: level,
      color: color,
    };
  },

  // Get timeline
  getTimeline() {
    return this.state.timeline;
  },

  // Get full analysis report
  getAnalysisReport() {
    const runtime = (Date.now() - this.state.startTime) / 1000;

    return {
      studentId: this.state.studentId,
      runtime: {
        seconds: Math.floor(runtime),
        formatted: `${Math.floor(runtime / 60)}:${String(Math.floor(runtime % 60)).padStart(2, '0')}`,
      },
      suspicionScore: this.getSuspicionScore(),
      riskAssessment: this.getRiskAssessment(),
      statistics: {
        tabSwitches: this.state.totalTabSwitches,
        pastes: this.state.totalPastes,
        devtoolsAttempts: this.state.totalDevtoolsDetections,
        violations: this.state.violations.length,
      },
      typing: this.getTypingAnalysis(),
      violations: this.state.violations,
      timeline: this.state.timeline,
      severity: {
        critical: this.state.violations.filter(v => v.severity === 'critical').length,
        warning: this.state.violations.filter(v => v.severity === 'warning').length,
        info: this.state.violations.filter(v => v.severity === 'info').length,
      },
      scoringModel: {
        version: '2.1-advantage-weighted',
        categoryRawRisk: this.state.categoryRawRisk,
        categoryEventCounts: this.state.categoryEventCounts,
      },
    };
  },

  // Export data for admin dashboard
  exportData() {
    return {
      timestamp: new Date().toISOString(),
      report: this.getAnalysisReport(),
    };
  },
};

// Initialize when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    antiCheat.init();
  });
} else {
  antiCheat.init();
}