/**
 * AI Anti-Cheat System (Behavior AI)
 * Analyzes user behavior patterns in real-time to detect suspicious activity
 */

const antiCheat = {
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
