// dashboard-app.js
let selectedStudentUID = null;
let currentView = 'dashboard';
let isInitialLoad = true; // สำหรับป้องกันการแจ้งเตือนรัวๆ ตอนโหลดหน้าครั้งแรก
let updateScheduled = false; // ป้องกันการอัปเดต UI ซ้ำซ้อนในเฟรมเดียวกัน
let lastViolationCount = {}; // จำจำนวนการทำผิดล่าสุดเพื่อแจ้งเตือน

// รายการโจทย์ข้อสอบ (ดึงมาจาก index.html)
const EXAM_QUESTIONS = [
    "ภาษา HTML ใช้ทำอะไร?",
    "CSS มีหน้าที่อะไร?",
    "JavaScript ใช้ในการทำอะไร?",
    "ตัวแปร (Variable) คืออะไร?",
    "Loop ใช้สำหรับการทำอะไร?",
    "Function มีประโยชน์อะไร?",
    "Database ใช้เพื่อการอะไร?",
    "API ในการเขียนโปรแกรมคืออะไร?"
];

document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    updateDashboard();
    
    // ปรับปรุงการดักฟังเหตุการณ์ให้ทำงานทันใจผ่าน requestAnimationFrame (Real-time 60FPS)
    window.addEventListener('storage', (e) => {
        if (!e.key) return;
        if (e.key.startsWith('mattep_live_user_') || e.key === 'mattep_live_sync_trigger' || e.key === 'mattepExamRecords') {
            if (!updateScheduled) {
                updateScheduled = true;
                requestAnimationFrame(() => {
                    updateDashboard();
                    updateScheduled = false;
                });
            }
        }
    });

    // ปรับรอบการดึงข้อมูลสำรองให้เร็วขึ้นเป็นทุก 1 วินาที เพื่อความสดใหม่
    setInterval(updateDashboard, 1000);

    setInterval(() => {
        const now = new Date();
        document.getElementById('timer').textContent = now.toLocaleTimeString('th-TH');
    }, 1000);
}

function getScoreValue(s) {
    // รองรับทั้งโครงสร้าง Live และ Record ที่ส่งมาคนละชื่อ
    return Math.round(s.suspicionScore || s.antiCheat?.suspicionScore || s.antiCheatReport?.suspicionScore || 0);
}

function updateDashboard() {
    // ดึงข้อมูล Live จากทุุกคีย์ที่ขึ้นต้นด้วย mattep_live_user_
    const liveStudents = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('mattep_live_user_')) {
            try {
                liveStudents.push(JSON.parse(localStorage.getItem(key)));
            } catch(e) {}
        }
    }

    const finishedData = JSON.parse(localStorage.getItem('mattepExamRecords') || '[]');
    
    let allStudents = [];
    // 1. นำเข้าข้อมูลคนสอบเสร็จ
    finishedData.forEach((item, index) => {
        allStudents.push({ 
            ...item, 
            uid: (item.uid || ('f-' + item.studentNo + '-' + item.name)) + '-fin' + index, // บังคับให้ UID ไม่ซ้ำกันเด็ดขาด
            status: 'finished', 
            no: item.studentNo, 
            risk: getScoreValue(item),
            sortTime: item.submitTimestamp || 0
        });
    });

    // 2. นำเข้าข้อมูลคนที่กำลังทำ
    liveStudents.forEach(item => {
        allStudents.push({ 
            ...item, 
            uid: item.uid,
            status: 'live', 
            no: item.no, 
            risk: getScoreValue(item),
            sortTime: item.lastUpdate || Date.now()
        });
        
        // ตรวจสอบพฤติกรรมใหม่เพื่อแสดง Toast
        checkNewViolations(item);
    });

    // กำหนด ID ให้แต่ละรายชื่อ (เช่น 000001) โดยเรียงตามเวลาที่เริ่มทำข้อสอบ
    const getStartTime = (s) => {
        if (s.uid && s.uid.startsWith('u-')) {
            const parts = s.uid.split('-');
            if (parts[1]) return parseInt(parts[1], 10);
        }
        return s.sortTime || 0;
    };
    const sortedForId = [...allStudents].sort((a, b) => getStartTime(a) - getStartTime(b));
    sortedForId.forEach((s, index) => {
        s.displayId = String(index + 1).padStart(6, '0');
    });

    // อัปเดตตัวเลือกห้องเรียนใน Dropdown อัตโนมัติ
    const uniqueClasses = [...new Set(allStudents.map(s => s.class || s.studentClass).filter(c => c))].sort();
    const classFilterEl = document.getElementById('classFilter');
    if (classFilterEl) {
        const currentValue = classFilterEl.value;
        classFilterEl.innerHTML = '<option value="all">🏫 แสดงทุกห้องเรียน</option>' + 
            uniqueClasses.map(c => `<option value="${c}">ห้อง ${c}</option>`).join('');
        if (uniqueClasses.includes(currentValue) || currentValue === 'all') {
            classFilterEl.value = currentValue;
        }
    }

    updateSummaryStats(allStudents);
    renderStudentList(allStudents);
    
    // อัปเดตเวลาการ Sync ล่าสุดบน UI
    const syncTimeEl = document.getElementById('syncTimeText');
    if (syncTimeEl) syncTimeEl.textContent = new Date().toLocaleTimeString('th-TH', { hour12: false });
    
    if (selectedStudentUID) updateDetailView(allStudents);
    isInitialLoad = false; // ปลดล็อกให้แสดงแจ้งเตือนได้หลังจากโหลดข้อมูลรอบแรกเสร็จ
}

function updateSummaryStats(students) {
    const total = students.length;
    const finished = students.filter(s => s.status === 'finished');
    const highRisk = students.filter(s => s.risk > 60).length;
    
    // คำนวณคะแนนเฉลี่ย (เฉพาะคนส่งแล้ว)
    let avgScore = 0;
    if (finished.length > 0) {
        const sum = finished.reduce((acc, curr) => acc + (curr.score || 0), 0);
        avgScore = (sum / finished.length).toFixed(1);
    }

    // คำนวณความเสี่ยงเฉลี่ย
    const avgRisk = total > 0 
        ? Math.round(students.reduce((acc, curr) => acc + curr.risk, 0) / total) 
        : 0;

    // อัปเดตตัวเลขและสีสถานะ (ถ้าไม่มีคนสอบให้เป็นสีเทา)
    const updateStat = (id, val) => {
        const el = document.getElementById(id);
        const card = el.closest('.bg-white');
        const oldVal = el.textContent;
        el.textContent = val;

        if (total > 0) {
            el.classList.remove('text-slate-300');
            el.classList.add('text-rose-500');
        } else {
            el.classList.replace('text-rose-500', 'text-slate-300');
        }
    };

    updateStat('totalStudents', total);
    updateStat('avgScore', avgScore);
    updateStat('avgRisk', avgRisk);
    updateStat('riskHigh', highRisk);

    const studentCountEl = document.getElementById('studentCount');
    if (studentCountEl.textContent !== String(total)) studentCountEl.textContent = total;

    // อัปเดต Progress Bars
    const lowCount = students.filter(s => s.risk <= 30).length;
    const medCount = students.filter(s => s.risk > 30 && s.risk <= 60).length;

    const updateBar = (id, count) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const el = document.getElementById(id);
        const newText = pct > 15 ? `${count} คน (${pct}%)` : (count > 0 ? count : '');
        
        if (el.style.width !== pct + '%') el.style.width = pct + '%';
        if (el.textContent !== newText) el.textContent = newText;
    };

    updateBar('riskLowBar', lowCount);
    updateBar('riskMediumBar', medCount);
    updateBar('riskHighBar', highRisk);

    // จัดการ "จุดสี" การกระจายความเสี่ยง (ถ้าไม่มีคนสอบให้จางลง)
    document.querySelectorAll('.risk-dot').forEach(dot => {
        dot.classList.toggle('grayscale', total === 0);
        dot.classList.toggle('opacity-30', total === 0);
    });
    
    // วิเคราะห์ข้อสอบ
    renderQuestionAnalysis(finished);
    renderTimeChart(students);
}

function renderQuestionAnalysis(finishedStudents) {
    const correctEl = document.getElementById('mostCorrectQuestions');
    const wrongEl = document.getElementById('mostWrongQuestions');

    if (finishedStudents.length === 0) {
        const placeholder = '<div class="text-xs text-slate-300 italic py-2">ยังไม่มีข้อมูลการส่งข้อสอบ</div>';
        correctEl.innerHTML = placeholder;
        wrongEl.innerHTML = placeholder;
        return;
    }
    
    let correctCount = Array(8).fill(0);
    finishedStudents.forEach(s => {
        if (s.objectiveAnswers) {
            s.objectiveAnswers.forEach((val, idx) => { if (val === 1) correctCount[idx]++; });
        }
    });

    const qStats = correctCount.map((count, i) => ({ q: i + 1, count }));
    const sorted = [...qStats].sort((a, b) => b.count - a.count);
    
    const renderItem = (item) => `
        <div onclick="showQuestionDetail(${item.q})" class="flex justify-between items-center py-2 border-b border-slate-50 hover:bg-rose-50/30 cursor-pointer transition-all px-1 rounded group">
            <div class="flex flex-col overflow-hidden">
                <span class="text-xs font-bold text-slate-500">ข้อที่ ${item.q}</span>
                <span class="text-[13px] text-slate-700 truncate w-full pr-4">${EXAM_QUESTIONS[item.q-1]}</span>
            </div>
            <span class="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">${item.count} คน</span>
        </div>
    `;

    document.getElementById('mostCorrectQuestions').innerHTML = sorted.slice(0, 3).map(renderItem).join('');
    document.getElementById('mostWrongQuestions').innerHTML = sorted.slice(-3).reverse().map(renderItem).join('');
}

function renderTimeChart(students) {
    const chartEl = document.getElementById('timeChart');
    if (!chartEl) return;

    if (students.length === 0) {
        chartEl.innerHTML = '<div class="text-xs text-slate-300 italic self-center w-full text-center">ยังไม่มีข้อมูลเวลา</div>';
        return;
    }

    let totalTimePerQuestion = Array(8).fill(0);
    let countPerQuestion = Array(8).fill(0);

    students.forEach(s => {
        // รองรับทั้งโครงสร้างข้อมูลแบบ Live (antiCheat) และแบบส่งแล้ว (antiCheatReport)
        const report = s.antiCheatReport || s.antiCheat;
        const intervals = report?.answerTiming?.intervals || [];
        intervals.forEach((ms, idx) => {
            if (idx < 8) {
                totalTimePerQuestion[idx] += ms;
                countPerQuestion[idx]++;
            }
        });
    });

    const averages = totalTimePerQuestion.map((total, i) =>
        countPerQuestion[i] ? parseFloat((total / countPerQuestion[i] / 1000).toFixed(1)) : 0
    );

    const maxSec = Math.max(...averages, 2); // ปรับ Scale ให้เห็นชัดขึ้น

    chartEl.innerHTML = averages.map((sec, i) => {
        const height = (sec / maxSec) * 100;
        const barColor = sec > 0 && sec < 1.5 ? 'bg-red-500 hover:bg-red-600' : 'bg-rose-400 hover:bg-rose-500';
        return `
            <div class="flex-1 flex flex-col items-center gap-2 group relative">
                <div class="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">${sec.toFixed(1)}s</div>
                <div class="w-full bg-slate-50 rounded-t-sm flex items-end h-full overflow-hidden border-x border-t border-slate-100">
                    <div class="w-full ${barColor} transition-all cursor-help" style="height: ${Math.max(height, sec > 0 ? 5 : 0)}%"></div>
                </div>
                <span class="text-[10px] font-bold text-slate-400">ข้อ ${i + 1}</span>
            </div>`;
    }).join('');
}

function renderStudentList(students) {
    const list = document.getElementById('studentList');
    const search = document.getElementById('searchInput').value.toLowerCase();
    const filter = document.getElementById('riskFilter').value;
    const classFilter = document.getElementById('classFilter') ? document.getElementById('classFilter').value : 'all';

    const newListHTML = students
        .filter(s => {
            const matchSearch = (s.name || '').toLowerCase().includes(search) || (s.no || '').includes(search);
            const sClass = String(s.class || s.studentClass || '');
            const matchClass = classFilter === 'all' || sClass === classFilter;

            let matchRisk = true;
            if (filter === 'high') matchRisk = s.risk > 60;
            if (filter === 'medium') matchRisk = s.risk > 30 && s.risk <= 60;
            if (filter === 'low') matchRisk = s.risk <= 30;

            return matchSearch && matchRisk && matchClass;
        })
        .sort((a, b) => {
            // 1. เรียงตามห้องเรียนก่อน (Class)
            const classA = String(a.class || a.studentClass || '').toLowerCase();
            const classB = String(b.class || b.studentClass || '').toLowerCase();
            if (classA < classB) return -1;
            if (classA > classB) return 1;
            
            // 2. ถ้าอยู่ห้องเดียวกัน ให้เรียงตามเลขที่จากน้อยไปมาก (Number)
            const noA = parseInt(a.no || a.studentNo || 0) || 0;
            const noB = parseInt(b.no || b.studentNo || 0) || 0;
            if (noA !== noB) return noA - noB;

            // 3. ถ้าอยู่ห้องเดียวกัน เลขที่เดียวกัน ให้คนที่ทำเสร็จแล้วขึ้นก่อน
            if (a.status !== b.status) return a.status === 'finished' ? -1 : 1;
            
            return b.risk - a.risk;
        })
        .map((s) => `
            <div onclick="selectStudent('${s.uid}')" 
                 class="p-3.5 mb-2 rounded-2xl border transition-all duration-300 cursor-pointer group 
                        ${selectedStudentUID === s.uid 
                          ? 'bg-rose-50/90 border-rose-300 shadow-sm translate-x-1' 
                          : 'bg-white/40 backdrop-blur-md border-rose-100/40 hover:bg-white/80 hover:border-rose-200 hover:translate-x-1 shadow-sm'}">
                <div class="flex justify-between items-start mb-1.5">
                    <div class="font-medium text-slate-800 truncate pr-2 text-sm">
                        ${s.name || 'ไม่ระบุชื่อ'}
                    </div>
                    ${s.status === 'live' 
                        ? `
                        <span class="flex items-center gap-1.5 bg-amber-50 text-amber-600 border border-amber-200/30 text-[9px] px-2 py-0.5 rounded-full font-bold animate-pulse">
                            <span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                            กำลังสอบ
                        </span>`
                        : `
                        <span class="flex items-center gap-1 bg-emerald-50 text-emerald-600 border border-emerald-200/30 text-[9px] px-2 py-0.5 rounded-full font-bold">
                            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                            ส่งแล้ว
                        </span>`}
                </div>
                <div class="flex justify-between items-center text-[11px]">
                    <div class="text-slate-500 font-light">เลขที่ ${s.no} • ${s.class || s.studentClass || '-'}</div>
                    <div class="flex items-center gap-1.5 font-bold ${s.risk > 60 ? 'text-rose-500' : s.risk > 30 ? 'text-amber-500' : 'text-emerald-500'}">
                        <span class="text-[9px] uppercase opacity-40 tracking-wider">Risk</span>
                        <span class="text-xs font-black">${s.risk}</span>
                    </div>
                </div>
            </div>
        `).join('');

    // Smart Render: อัปเดต HTML เฉพาะเมื่อมีการเปลี่ยนแปลงข้อมูลจริงๆ 
    // เพื่อป้องกันรายชื่อ "เด้ง" หรือ "กระพริบ" ทุกครั้งที่ Sync
    if (list.innerHTML !== newListHTML) {
        list.innerHTML = newListHTML;
    }
}

function selectStudent(uid) {
    selectedStudentUID = uid;
    document.getElementById('dashboardView').classList.add('hidden-view');
    document.getElementById('studentDetailView').classList.remove('hidden-view');
    document.getElementById('backButton').classList.remove('hidden-view');
    updateDashboard();
}

function showDashboard() {
    selectedStudentUID = null;
    currentView = 'dashboard';
    document.getElementById('studentDetailView').classList.add('hidden-view');
    document.getElementById('dashboardView').classList.remove('hidden-view');
    document.getElementById('backButton').classList.add('hidden-view');
    updateDashboard();
}

function updateDetailView(students) {
    const s = students.find(st => st.uid === selectedStudentUID);
    if (!s) return;

    const displayName = s.name || 'ไม่ระบุชื่อ';
    document.getElementById('detailNameTitle').textContent = displayName;
    document.getElementById('detailName').textContent = displayName;
    document.getElementById('detailClass').textContent = `เลขที่ ${s.no} / ${s.class || s.studentClass || '-'}`;
    document.getElementById('detailScore').textContent = s.status === 'finished' ? `${s.score}/${s.scoreMax || 8}` : 'กำลังทำ...';
    
    // แสดงคำตอบปรนัยแบบ Real-time
    const objGrid = document.getElementById('liveObjectiveGrid');
    const objAnswers = s.objectiveAnswers || [];
    objGrid.innerHTML = Array(8).fill(0).map((_, i) => {
        const ans = objAnswers[i] || '-';
        const isSelected = ans !== '-';
        return `
            <div class="flex flex-col items-center p-2 rounded-lg border ${isSelected ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'}">
                <span class="text-[9px] font-bold text-slate-400 mb-1">${i+1}</span>
                <span class="text-sm font-black ${isSelected ? 'text-rose-600' : 'text-slate-300'}">${ans}</span>
            </div>
        `;
    }).join('');

    // แสดงคำตอบอัตนัยแบบ Real-time
    document.getElementById('liveEssay1').textContent = s.essays?.essay1 || 'ยังไม่มีคำตอบ...';
    document.getElementById('liveEssay2').textContent = s.essays?.essay2 || 'ยังไม่มีคำตอบ...';

    const risk = s.risk || 0;
    const detailRisk = document.getElementById('detailRisk');
    detailRisk.textContent = risk;
    detailRisk.className = `text-3xl font-black ${risk > 60 ? 'text-rose-500' : risk > 30 ? 'text-amber-500' : 'text-emerald-500'}`;

    // รายการพฤติกรรมสรุป (Activity List)
    const activityList = document.getElementById('activityList');
    const violations = s.violations || s.antiCheat?.violations || s.antiCheatReport?.violations || [];
    if (violations.length > 0) {
        const summary = {};
        violations.forEach(v => { summary[v.category] = (summary[v.category] || 0) + 1; });
        activityList.innerHTML = Object.entries(summary).map(([cat, count]) => `
            <li class="flex justify-between items-center text-sm"><span class="text-slate-600">${cat}</span><span class="font-bold text-rose-500">${count} ครั้ง</span></li>
        `).join('');
    } else {
        activityList.innerHTML = '<li class="text-sm text-slate-400 italic">ไม่พบพฤติกรรมเสี่ยง</li>';
    }

    // สถิติ AI (Status List)
    const statusList = document.getElementById('statusList');
    const stats = s.statistics || s.antiCheat?.statistics || s.antiCheatReport?.statistics || {};
    const statusItems = [
        { label: 'สลับหน้าจอ (Tab Switch)', val: stats.tabSwitch || 0 },
        { label: 'วางข้อความ (Paste)', val: stats.paste || 0 },
        { label: 'พยายามเปิด DevTools', val: stats.devtools || 0 },
        { label: 'คัดลอกข้อสอบ (Copy)', val: stats.copy || 0 }
    ];
    statusList.innerHTML = statusItems.map(item => `
        <li class="flex justify-between items-center text-sm"><span class="text-slate-600">${item.label}</span><span class="font-bold ${item.val > 0 ? 'text-rose-500' : 'text-emerald-500'}">${item.val} ครั้ง</span></li>
    `).join('');

    // ลำดับเหตุการณ์ (Event List)
    const eventLogList = document.getElementById('eventList');
    if (violations.length > 0) {
        eventLogList.innerHTML = [...violations].reverse().map(v => {
            const isHigh = v.points >= 25;
            const iconColor = isHigh ? 'text-rose-500' : 'text-amber-500';
            const bgColor = isHigh ? 'bg-rose-50' : 'bg-amber-50';
            const borderColor = isHigh ? 'border-rose-100' : 'border-amber-100';
            const badgeColor = isHigh ? 'bg-gradient-to-r from-rose-500 to-rose-400 text-white' : 'bg-gradient-to-r from-amber-500 to-amber-400 text-white';
            
            return `
                        <li class="p-3 rounded-xl border ${borderColor} ${bgColor} flex items-start gap-3 transition-transform hover:-translate-y-0.5 shadow-sm mb-1">
                            <div class="mt-0.5 ${iconColor}">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                                </svg>
                            </div>
                            <div class="flex-1">
                                <div class="flex justify-between items-start mb-1">
                                    <span class="font-bold text-slate-800 text-sm">${v.category}</span>
                                    <span class="text-xs text-slate-500 font-medium">${v.time || '00:00:00'}</span>
                                </div>
                                <div class="text-xs text-slate-600">${v.description}</div>
                            </div>
                            <div class="px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm ${badgeColor} flex-shrink-0">
                                +${v.points}
                            </div>
                        </li>
            `;
        }).join('');
    } else {
        eventLogList.innerHTML = `
                    <li class="flex flex-col items-center justify-center text-slate-400 h-full gap-2 opacity-60">
                        <svg class="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="text-sm font-medium">ไม่พบเหตุการณ์ผิดปกติ</span>
                    </li>
        `;
    }
}

function exportReport() { alert('ฟีเจอร์การส่งออก PDF กำลังอยู่ในการพัฒนา'); }
function clearAllData() { if (confirm('ล้างข้อมูลทั้งหมด?')) { localStorage.clear(); location.reload(); } }
function logout() { window.location.href = 'home.html'; }
function filterStudents() { updateDashboard(); }

// ฟังก์ชันสำหรับแจ้งเตือนแบบ Real-time Toast
function checkNewViolations(student) {
    const studentKey = student.uid;
    const violations = student.antiCheat?.violations || [];
    const currentCount = violations.length;

    // ถ้าเป็นการโหลดครั้งแรก ให้จำจำนวนไว้เฉยๆ ไม่ต้องแจ้งเตือน
    if (isInitialLoad) {
        lastViolationCount[studentKey] = currentCount;
        return;
    }
    
    // ถ้ามีเคสใหม่เพิ่มขึ้น ให้แสดง Toast
    if (currentCount > (lastViolationCount[studentKey] || 0)) {
        const newVio = violations[violations.length - 1];
        showLiveToast(student.name, newVio.description, student.no);
    }
    lastViolationCount[studentKey] = currentCount;
}

function showLiveToast(name, desc, no) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'bg-white border-l-4 border-rose-500 shadow-2xl p-4 rounded-r-lg mb-3 animate-slide-in-right flex flex-col gap-1 min-w-[280px]';
    toast.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="font-bold text-rose-600 text-xs">ตรวจพบความผิดปกติ!</span>
            <span class="text-[10px] text-slate-400">เมื่อครู่นี้</span>
        </div>
        <div class="text-sm font-bold text-slate-800">${name || 'ไม่ระบุชื่อ'} (เลขที่ ${no || '-'})</div>
        <div class="text-xs text-slate-500">${desc}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('animate-fade-out-right');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

/**
 * แสดงรายละเอียดโจทย์ข้อสอบเมื่อคลิก
 */
function showQuestionDetail(qNum) {
    const text = EXAM_QUESTIONS[qNum - 1];
    const modal = document.getElementById('evidenceModal');
    const content = document.getElementById('modalContentBlock');
    
    document.getElementById('modalTitle').textContent = `โจทย์ปรนัยข้อที่ ${qNum}`;
    document.getElementById('modalDescription').textContent = text;
    document.getElementById('modalTime').textContent = "หมวด: ปรนัย";
    document.getElementById('modalImage').style.display = 'none'; // ซ่อนส่วนรูปภาพสำหรับโจทย์

    modal.classList.remove('hidden-view');
    setTimeout(() => {
        content.classList.remove('scale-90', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closeEvidenceModal() {
    const modal = document.getElementById('evidenceModal');
    const content = document.getElementById('modalContentBlock');
    content.classList.add('scale-90', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden-view');
        document.getElementById('modalImage').style.display = 'flex'; // คืนค่าส่วนรูปภาพ
    }, 300);
}